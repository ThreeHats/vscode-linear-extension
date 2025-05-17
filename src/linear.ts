import { ExtensionContext, SecretStorage, Memento } from "vscode";
import * as vscode from "vscode";
import {
  Comment,
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
    const apiKey = await _secretStorage.get("apiKey");
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

// Connect to Linear using VS Code's authentication API or manual API key
export const connect = async (): Promise<boolean> => {
  try {
    // Ask the user which authentication method they want to use
    const authMethod = await vscode.window.showQuickPick(
      [
        { label: "Sign in with OAuth", description: "Use your Linear account to authenticate" },
        { label: "Use API Key", description: "Manually provide an API key from Linear" }
      ],
      { placeHolder: "Select authentication method" }
    );

    if (!authMethod) {
      return false; // User cancelled
    }

    if (authMethod.label === "Sign in with OAuth") {
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
    } else {
      // Manual API key entry
      const apiKey = await vscode.window.showInputBox({
        placeHolder: "Enter your Linear API key",
        password: true, // Mask the input for security
        prompt: "You can generate an API key in Linear at Settings > API > OAuth Applications > Developer Token",
      });

      if (!apiKey) {
        return false; // User cancelled
      }

      // Test the API key by initializing a client and making a simple call
      try {
        const testClient = new LinearClient({ apiKey });
        // Try to get the viewer (current user) to validate the key
        await testClient.viewer;
        
        // Store the API key securely
        await _secretStorage.store("apiKey", apiKey);
        
        // Initialize the main client
        _client = testClient;
        return true;
      } catch (error) {
        vscode.window.showErrorMessage("Invalid API key. Please check and try again.");
        return false;
      }
    }
  } catch (err) {
    console.error("Error authenticating with Linear", err);
    return false;
  }
};

// Sign out from Linear
export const disconnect = async (): Promise<boolean> => {
  try {
    // Clear any stored API key
    await _secretStorage.delete("apiKey");
    
    // Clear OAuth session if it exists
    try {
      const session = await vscode.authentication.getSession(
        LINEAR_AUTHENTICATION_PROVIDER_ID,
        LINEAR_AUTHENTICATION_SCOPES,
        { createIfNone: false }
      );
      
      if (session) {
        // VS Code doesn't have a direct way to sign out a specific session
        // but we can let the user know they can manage sessions in settings
        vscode.window.showInformationMessage(
          "To completely remove OAuth authorization, go to File > Preferences > Settings > Accounts > Linear to manage your sessions."
        );
      }
    } catch (error) {
      // Ignore errors getting the session - we still want to reset the client
      console.log("Error checking authentication session:", error);
    }
    
    // Set the client to null - next time the user tries to use Linear features
    // they'll be prompted to authenticate again
    _client = null;
    
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

export const getContextIssueWithDetails = async (): Promise<{issue: Issue, assignee?: User, creator?: User, team?: Team, subscribers?: User[], comments?: Comment[]} | null> => {
  if (!_client) {
    return null;
  }
  try {
    const issueId = _storage.get("linearContextIssueId")?.toString();  
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
    
    // Safely handle null values in comments and other entities
    const subscribers = subscribersConnection?.nodes || [];
    const comments = commentsConnection?.nodes || [];
    
    return {
      issue,
      assignee: assignee || undefined,
      creator: creator || undefined,
      team: team || undefined,
      subscribers,
      comments
    };
  } catch (err) {
    console.error("Error retrieving context issue with details", err);
  }
  return null;
};
