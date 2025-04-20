import { ExtensionContext, SecretStorage, Memento } from "vscode";
import * as vscode from "vscode";
import {
  Issue,
  IssuePayload,
  IssuePriorityValue,
  LinearClient,
  Team,
  User,
  WorkflowState,
} from "@linear/sdk";

// Authentication constants for Linear
const LINEAR_AUTHENTICATION_PROVIDER_ID = "linear";
const LINEAR_AUTHENTICATION_SCOPES = ["read", "write", "issues:create"];

let _secretStorage: SecretStorage;
let _storage: Memento;
let _client: LinearClient | null = null;

export const init = async (context: ExtensionContext): Promise<boolean> => {
  _secretStorage = context.secrets;
  _storage = context.workspaceState;
  
  try {
    // Try to get authentication session using VS Code's built-in authentication API
    const session = await vscode.authentication.getSession(
      LINEAR_AUTHENTICATION_PROVIDER_ID,
      LINEAR_AUTHENTICATION_SCOPES,
      { createIfNone: false }
    );

    if (session) {
      // Initialize Linear client with the access token from the session
      _client = new LinearClient({
        accessToken: session.accessToken,
      });
      return true;
    }
    
    // Fall back to checking for API key (for backward compatibility)
    const apiKey = (await _secretStorage.get("apiKey"))?.toString();
    if (apiKey) {
      _client = new LinearClient({
        apiKey,
      });
      return true;
    }
    
  } catch (err) {
    console.error("Error initializing Linear client", err);
  }
  
  return false;
};

// Connect to Linear using VS Code's authentication API
export const connect = async (): Promise<boolean> => {
  try {
    // Request an authentication session, creating one if none exists
    const session = await vscode.authentication.getSession(
      LINEAR_AUTHENTICATION_PROVIDER_ID,
      LINEAR_AUTHENTICATION_SCOPES,
      { createIfNone: true }
    );

    if (!session) {
      vscode.window.showErrorMessage("Failed to authenticate with Linear");
      return false;
    }

    // Initialize Linear client with the access token
    _client = new LinearClient({
      accessToken: session.accessToken,
    });
    return true;
  } catch (err) {
    console.error("Error authenticating with Linear", err);
    return false;
  }
};

// Sign out from Linear
export const disconnect = async (): Promise<boolean> => {
  try {
    // Clear the stored API key (if any)
    await _secretStorage.delete("apiKey");
    
    // Simply set the client to null - next time the user tries to use Linear features
    // they'll be prompted to authenticate again
    _client = null;
    
    // We don't need to explicitly clear the session - VS Code manages the sessions
    // and will prompt for re-authentication when needed
    return true;
  } catch (err) {
    console.error("Error signing out from Linear", err);
    return false;
  }
};

export const getMyIssues = async (): Promise<Issue[] | null> => {
  if (_client) {
    try {
      const me = await _client.viewer;
      const myIssues = await me.assignedIssues();

      return myIssues.nodes;
    } catch (err) {
      console.error("Error getting my issues", err);
    }
  } else {
    console.error("No initialized Linear client found");
  }
  return null;
};

export const getMyTeams = async (): Promise<Team[] | null> => {
  if (_client) {
    try {
      const me = await _client.viewer;
      const myTeams = await me.teams();

      return myTeams.nodes;
    } catch (err) {
      console.error("Error getting my teams", err);
    }
  } else {
    console.error("No initialized Linear client found");
  }
  return null;
};

export const getIssueByIdentifier = async (
  identifier: string
): Promise<Issue | null> => {
  if (_client) {
    try {
      const issue = await _client.issue(identifier);

      return issue || null;
    } catch (err) {
      console.error("Error getting issue by identifier", err);
    }
  } else {
    console.error("No initialized Linear client found");
  }
  return null;
};

export const setContextIssueId = async (issueId?: string): Promise<boolean> => {
  if (!issueId) {
    return false;
  }
  try {
    await _storage.update("linearContextIssueId", issueId);
  } catch (err) {
    console.error("Error setting context issue", err);
    return false;
  }
  return true;
};

export const addContextIssueComment = async (
  comment: string
): Promise<boolean> => {
  if (!_client) {
    return false;
  }
  if (!comment) {
    return false;
  }
  try {
    const issueId = (await _storage.get("linearContextIssueId")) as string;
    if (!issueId) {
      return false;
    }
    const commentPayload = await _client.commentCreate({
      issueId,
      body: comment,
    });
    if (!commentPayload.success) {
      return false;
    }
  } catch (err) {
    console.error("Error commenting context issue", err);
    return false;
  }
  return true;
};

export const getWorkflowStates = async (): Promise<WorkflowState[] | null> => {
  if (_client) {
    try {
      const workflowStates = await _client.workflowStates();

      return workflowStates.nodes;
    } catch (err) {
      console.error("Error getting workflow states", err);
    }
  } else {
    console.error("No initialized Linear client found");
  }
  return null;
};

export const setContextIssueStatus = async (
  status: string
): Promise<boolean> => {
  if (!_client) {
    return false;
  }
  if (!status) {
    return false;
  }
  try {
    const issueId = (await _storage.get("linearContextIssueId")) as string;
    if (!issueId) {
      return false;
    }
    const statusPayload = await _client.issueUpdate(issueId, {
      stateId: status,
    });
    if (!statusPayload.success) {
      return false;
    }
  } catch (err) {
    console.error("Error setting context issue status", err);
    return false;
  }
  return true;
};

export const getAvailablePriorities = async (): Promise<
  IssuePriorityValue[] | null
> => {
  if (_client) {
    try {
      const availablePriorities = await _client.issuePriorityValues;

      return availablePriorities;
    } catch (err) {
      console.error("Error getting priorities", err);
    }
  } else {
    console.error("No initialized Linear client found");
  }
  return null;
};

export const getTeamMembers = async (team: Team): Promise<User[] | null> => {
  if (_client) {
    try {
      const teamMembers = await team.members();

      return teamMembers.nodes;
    } catch (err) {
      console.error("Error getting team members", err);
    }
  } else {
    console.error("No initialized Linear client found");
  }
  return null;
};

export const createIssue = async (
  title: string,
  teamId: string,
  description: string | undefined,
  assigneeId: string | undefined,
  stateId: string | undefined,
  estimate: number | undefined,
  priority: number | undefined
): Promise<IssuePayload | undefined> => {
  if (!_client) {
    return;
  }

  try {
    const issuePayload = await _client.issueCreate({
      title,
      teamId,
      description,
      assigneeId,
      stateId,
      estimate,
      priority,
    });
    if (!issuePayload.success) {
      return;
    }
    return issuePayload;
  } catch (err) {
    console.error("Error creating issue", err);
  }
  return;
};

export const getContextIssue = async (): Promise<Issue | undefined> => {
  if (!_client) {
    return;
  }
  try {
    const issueId = (await _storage.get("linearContextIssueId")) as string;
    if (!issueId) {
      return;
    }
    const issue = await _client.issue(issueId);
    return issue;
  } catch (err) {
    console.error("Error retrieving context issue", err);
  }
  return;
};

export const getContextIssueWithDetails = async (): Promise<{issue: Issue, assignee?: User, creator?: User, team?: Team, subscribers?: User[], comments?: any[]} | null> => {
  if (!_client) {
    return null;
  }
  try {
    const issueId = (await _storage.get("linearContextIssueId")) as string;
    if (!issueId) {
      return null;
    }
    
    const issue = await _client.issue(issueId);
    if (!issue) {
      return null;
    }
    
    // Get related data
    const [assignee, creator, team, subscribersConnection, commentsConnection] = await Promise.all([
      issue.assignee,
      issue.creator,
      issue.team,
      issue.subscribers(),
      issue.comments({ first: 100 }) // Get up to 100 comments
    ]);
    
    const subscribers = subscribersConnection?.nodes;
    const comments = commentsConnection?.nodes;
    
    return {
      issue,
      assignee,
      creator,
      team,
      subscribers,
      comments
    };
  } catch (err) {
    console.error("Error retrieving context issue with details", err);
  }
  return null;
};
