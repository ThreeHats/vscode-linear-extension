import * as vscode from "vscode";

import {
  init,
  getMyIssues,
  setContextIssueId,
  addContextIssueComment,
  getIssueByIdentifier,
  getWorkflowStates,
  setContextIssueStatus,
  createIssue,
  getMyTeams,
  getTeamMembers,
  getAvailablePriorities,
  getContextIssue,
  getContextIssueWithDetails,
  connect,
  disconnect
} from "./linear";

const TITLE = "Linear";

// This method is called when the extension is activated.
// The extension is activated the very first time the command is executed.
export async function activate(context: vscode.ExtensionContext) {
  const hasAuth = await init(context);

  if (!hasAuth) {
    vscode.window.showInformationMessage(
      'Please run "Linear: Connect" to initialize the connection'
    );
  }

  // Commands have been defined in the package.json file
  // The commandId parameter must match the command field in package.json

  const connectDisposable = vscode.commands.registerCommand(
    "linear.connect",
    async () => {
      try {
        const success = await connect();
        
        if (success) {
          vscode.window.showInformationMessage(
            "Successfully connected to Linear!"
          );
        } else {
          vscode.window.showErrorMessage(
            "Failed to connect to Linear. Please try again."
          );
        }
      } catch (error: any) {
        vscode.window.showErrorMessage(
          `Failed to authenticate with Linear: ${error.message}`
        );
      }
    }
  );
  context.subscriptions.push(connectDisposable);
  
  const disconnectDisposable = vscode.commands.registerCommand(
    "linear.disconnect", 
    async () => {
      const success = await disconnect();
      
      if (success) {
        vscode.window.showInformationMessage("Disconnected from Linear. Run 'Linear: Connect' to reconnect.");
      } else {
        vscode.window.showErrorMessage("Failed to disconnect from Linear. Please try again.");
      }
    }
  );
  context.subscriptions.push(disconnectDisposable);

  const getMyIssuesDisposable = vscode.commands.registerCommand(
    "linear.getMyIssues",
    () => {
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          cancellable: false,
          title: TITLE
        },
        async (progress, token) => {
          token.onCancellationRequested(() => {
            console.log("User canceled the long running operation");
          });

          try {
            progress.report({ increment: 0, message: "Fetching issues..." });
            const issues = await getMyIssues();
            
            // Update message to indicate fetching is complete
            progress.report({ increment: 100, message: `${issues?.length || 0} Issues fetched` });
            
            const selectedIssue = await vscode.window.showQuickPick(
              issues?.map((issue) => ({
                label: `${issue.identifier} ${issue.title}`,
                description: issue.identifier,
                target: issue.id,
                issue,
              })) || [],
              {
                placeHolder: "Select an issue to save to the working context",
              }
            );
            if (selectedIssue) {
              setContextIssueId(selectedIssue.target);
              vscode.window.showInformationMessage(
                `Linear context issue is set to ${selectedIssue.description}`
              );

              const { issue } = selectedIssue;
              if (issue) {
                const action = await vscode.window.showInformationMessage(
                  `Actions for issue ${issue.identifier}`,
                  "Copy ID",
                  "Copy branch name",
                  "Open in browser"
                );
                if (action) {
                  switch (action) {
                    case "Copy ID":
                      await vscode.env.clipboard.writeText(issue.identifier);
                      vscode.window.showInformationMessage(
                        `Copied ID ${issue.identifier} to clipboard!`
                      );
                      break;
                    case "Copy branch name":
                      await vscode.env.clipboard.writeText(issue.branchName);
                      vscode.window.showInformationMessage(
                        `Copied branch name ${issue.branchName} to clipboard!`
                      );
                      break;
                    case "Open in browser":
                      vscode.env.openExternal(vscode.Uri.parse(issue.url));
                      break;
                  }
                }
              }
            }
            return issues; // Return value resolves the Promise to complete the progress
          } catch (error) {
            console.error("Error fetching issues:", error);
            vscode.window.showErrorMessage("Failed to fetch Linear issues");
            return null; // Ensure Promise completes even on error
          }
        }
      );
    }
  );
  context.subscriptions.push(getMyIssuesDisposable);

  const addContextIssueCommentDisposable = vscode.commands.registerCommand(
    "linear.addContextIssueComment",
    async () => {
      const comment = (
        await vscode.window.showInputBox({ placeHolder: "Comment" })
      )?.toString();

      if (comment) {
        if (await addContextIssueComment(comment)) {
          vscode.window.showInformationMessage("Context issue comment added");
        } else {
          vscode.window.showErrorMessage("Error commenting the context issue");
        }
      } else {
        vscode.window.showErrorMessage("Comment cannot be empty");
      }
    }
  );
  context.subscriptions.push(addContextIssueCommentDisposable);

  const setContextIssueDisposable = vscode.commands.registerCommand(
    "linear.setContextIssue",
    () => {
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          cancellable: false,
          title: TITLE
        },
        async (progress, token) => {
          token.onCancellationRequested(() => {
            console.log("User canceled the long running operation");
          });

          try {
            const identifier = (
              await vscode.window.showInputBox({
                placeHolder: "Issue identifier",
              })
            )?.toString();

            if (!identifier) {
              return null; // Return value to complete the progress
            }

            progress.report({
              increment: 0,
              message: `Fetching issue ${identifier}...`,
            });
            const selectedIssue = await getIssueByIdentifier(identifier);
            progress.report({ 
              increment: 100,
              message: selectedIssue ? "Issue selected" : "Issue not found" 
            });

            if (selectedIssue) {
              setContextIssueId(selectedIssue.id);
              vscode.window.showInformationMessage(
                `Linear context issue is set to ${selectedIssue.identifier}`
              );
            } else {
              vscode.window.showErrorMessage(
                `Linear issue ${identifier} was not found`
              );
            }
            return selectedIssue; // Return value resolves the Promise to complete the progress
          } catch (error) {
            console.error("Error fetching issue:", error);
            vscode.window.showErrorMessage("Failed to fetch Linear issue");
            return null; // Ensure Promise completes even on error
          }
        }
      );
    }
  );
  context.subscriptions.push(setContextIssueDisposable);

  const setContextIssueStatusDisposable = vscode.commands.registerCommand(
    "linear.setContextIssueStatus",
    async () => {
      vscode.window.showInformationMessage("Getting available statuses...");
      const statuses = await getWorkflowStates();

      // Resolve all promise objects first
      const resolvedStatuses = statuses ? await Promise.all(statuses) : [];

      const selectedStatus = await vscode.window.showQuickPick(
        resolvedStatuses.map((status) => ({
          label: status.name,
          target: status.id,
        })) || [],
        {
          placeHolder: "Select a status to set for the issue",
        }
      );
      if (selectedStatus) {
        setContextIssueStatus(selectedStatus.target);
        vscode.window.showInformationMessage(
          `Linear context issue status is set to ${selectedStatus.label}`
        );
      }
    }
  );
  context.subscriptions.push(setContextIssueStatusDisposable);

  const createIssueDisposable = vscode.commands.registerCommand(
    "linear.createIssue",
    async () => {
      const title = (
        await vscode.window.showInputBox({
          placeHolder: "Please provide a title for the issue",
        })
      )?.toString();

      let selectedTeam;

      const myTeams = await getMyTeams();
      if (myTeams && myTeams.length > 1) {
        selectedTeam = await vscode.window.showQuickPick(
          myTeams?.map((team) => ({
            label: team.name,
            target: team.id,
            linearTeam: team,
          })) || [],
          {
            placeHolder: "Select a team to set for the issue",
          }
        );
      } else if (myTeams && myTeams.length === 1) {
        const team = myTeams?.[0];
        selectedTeam = { label: team.name, target: team.id, linearTeam: team };
        vscode.window.showInformationMessage(
          `Creating issue in team ${selectedTeam.label}.`
        );
      }

      // They're mandatory
      if (title && selectedTeam) {
        const description = (
          await vscode.window.showInputBox({
            placeHolder: "Please provide a description",
          })
        )?.toString();

        const availableStatuses = await getWorkflowStates();
        // Resolve all promise objects first
        const resolvedStatuses = availableStatuses ? await Promise.all(availableStatuses) : [];
        
        const selectedStatus = await vscode.window.showQuickPick(
          resolvedStatuses.map((status) => ({
            label: status.name,
            target: status.id,
          })) || [],
          {
            placeHolder: "Select a status to set for the issue",
          }
        );

        const availableAssignees = await getTeamMembers(
          selectedTeam.linearTeam
        );
        const selectedAssignee = await vscode.window.showQuickPick(
          availableAssignees?.map((assignee) => ({
            label: assignee.name,
            target: assignee.id,
          })) || [],
          {
            placeHolder: "Select an assignee to set for the issue",
          }
        );

        let estimateString = await vscode.window.showInputBox({
          placeHolder: "Please provide an estimate",
        });
        let estimate = estimateString
          ? parseInt(estimateString, 10)
          : undefined;

        const availablePriorities = await getAvailablePriorities();
        const selectedPriority = await vscode.window.showQuickPick(
          availablePriorities?.map((priority) => ({
            label: priority.label,
            target: priority.priority,
          })) || [],
          {
            placeHolder: "Select a priority to set for the issue",
          }
        );

        const issuePayload = await createIssue(
          title,
          selectedTeam.target,
          description,
          selectedAssignee?.target,
          selectedStatus?.target,
          estimate,
          selectedPriority?.target
        );

        if (issuePayload?.success) {
          const issue = await issuePayload.issue;
          if (issue) {
            const action = await vscode.window.showInformationMessage(
              `Issue ${issue.identifier} created`,
              "Set active",
              "Copy ID",
              "Copy branch name",
              "Open in browser"
            );
            if (action) {
              switch (action) {
                case "Set active":
                  setContextIssueStatus(issue.identifier);
                  vscode.window.showInformationMessage(
                    `Set ${issue.identifier} as active!`
                  );
                  break;
                case "Copy ID":
                  await vscode.env.clipboard.writeText(issue.identifier);
                  vscode.window.showInformationMessage(
                    `Copied ID ${issue.identifier} to clipboard!`
                  );
                  break;
                case "Copy branch name":
                  await vscode.env.clipboard.writeText(issue.branchName);
                  vscode.window.showInformationMessage(
                    `Copied branch name ${issue.branchName} to clipboard!`
                  );
                  break;
                case "Open in browser":
                  vscode.env.openExternal(vscode.Uri.parse(issue.url));
                  break;
              }
            }
          }
        }
      } else {
        vscode.window.showErrorMessage("Title cannot be empty");
      }
    }
  );
  context.subscriptions.push(createIssueDisposable);

  const showContextIssueActionsDisposable = vscode.commands.registerCommand(
    "linear.showContextIssueActions",
    async () => {
      const issue = await getContextIssue();
      if (issue) {
        const action = await vscode.window.showInformationMessage(
          `Actions for ${issue.identifier}`,
          "Copy ID",
          "Copy branch name",
          "Open in browser"
        );
        if (action) {
          switch (action) {
            case "Copy ID":
              await vscode.env.clipboard.writeText(issue.identifier);
              vscode.window.showInformationMessage(
                `Copied ID ${issue.identifier} to clipboard!`
              );
              break;
            case "Copy branch name":
              await vscode.env.clipboard.writeText(issue.branchName);
              vscode.window.showInformationMessage(
                `Copied branch name ${issue.branchName} to clipboard!`
              );
              break;
            case "Open in browser":
              vscode.env.openExternal(vscode.Uri.parse(issue.url));
              break;
          }
        }
      }
    }
  );
  context.subscriptions.push(showContextIssueActionsDisposable);

  const getContextIssueDetailsDisposable = vscode.commands.registerCommand(
    "linear.getContextIssueDetails",
    async () => {
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          cancellable: false,
          title: TITLE
        },
        async (progress, token) => {
          token.onCancellationRequested(() => {
            console.log("User canceled the long running operation");
          });

          try {
            progress.report({ increment: 0, message: "Fetching issue details..." });
            const issueDetails = await getContextIssueWithDetails();
            
            progress.report({ increment: 100, message: "Issue details fetched" });
            
            if (!issueDetails) {
              vscode.window.showErrorMessage("No active context issue found.");
              return null;
            }

            // Create and show an information panel with the issue details
            const panel = vscode.window.createWebviewPanel(
              'linearIssueDetails',
              `${issueDetails.issue.identifier} - Issue details`,
              vscode.ViewColumn.One,
              {
                enableScripts: true
              }
            );
            
            // Format the issue priority as text
            // Use the getAvailablePriorities function to fetch custom priority labels
            const availablePriorities = await getAvailablePriorities() || [];
            
            // Create a mapping from priority values to their custom labels
            const priorityLabels: { [key: number]: string } = {};
            availablePriorities.forEach(priority => {
              priorityLabels[priority.priority] = priority.label;
            });
            
            // Get priority text from mapped labels or default to "Unknown"/"None"
            const priorityText = issueDetails.issue.priority !== null && issueDetails.issue.priority !== undefined 
              ? priorityLabels[issueDetails.issue.priority] || "Unknown"
              : "None";
            
            // Resolve state if it's a promise
            let stateName = "Unknown Status";
            if (issueDetails.issue.state) {
              try {
                const state = await issueDetails.issue.state;
                stateName = state.name || "Unknown Status";
              } catch (error) {
                console.error("Error resolving issue state:", error);
              }
            }
            
            // Create HTML content for the webview
            panel.webview.html = `
              <!DOCTYPE html>
              <html lang="en">
              <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Issue Details</title>
                <style>
                  body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                    padding: 20px;
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                  }
                  .container {
                    max-width: 800px;
                    margin: 0 auto;
                  }
                  h1 {
                    margin-bottom: 5px;
                    font-size: 24px;
                  }
                  h2 {
                    font-size: 16px;
                    margin-top: 20px;
                    margin-bottom: 10px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    padding-bottom: 5px;
                  }
                  .identifier {
                    font-weight: bold;
                    color: var(--vscode-textLink-foreground);
                    margin-right: 10px;
                  }
                  .meta {
                    margin-bottom: 20px;
                    color: var(--vscode-descriptionForeground);
                    font-size: 14px;
                  }
                  .label {
                    font-weight: bold;
                    margin-right: 5px;
                  }
                  .desc {
                    white-space: pre-wrap;
                    margin-bottom: 20px;
                    line-height: 1.5;
                  }
                  .status {
                    display: inline-block;
                    padding: 3px 8px;
                    border-radius: 3px;
                    background-color: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground);
                    margin-right: 10px;
                  }
                  .actions {
                    margin-top: 20px;
                  }
                  button {
                    padding: 8px 12px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 3px;
                    cursor: pointer;
                    margin-right: 10px;
                  }
                  button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                  }
                  .info-row {
                    margin-bottom: 10px;
                  }
                  .subscribers {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 10px;
                    margin-top: 10px;
                  }
                  .subscriber {
                    padding: 3px 8px;
                    background-color: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground);
                    border-radius: 3px;
                  }
                  .comments-list {
                    margin-top: 20px;
                  }
                  .comment {
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 5px;
                    padding: 10px;
                    margin-bottom: 10px;
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                  }
                  .comment-header {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 8px;
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                  }
                  .comment-author {
                    font-weight: bold;
                  }
                  .comment-body {
                    white-space: pre-wrap;
                    line-height: 1.5;
                  }
                </style>
              </head>
              <body>
                <div class="container">
                  <h1>
                    <span class="identifier">${issueDetails.issue.identifier}</span>
                    ${issueDetails.issue.title}
                  </h1>
                  
                  <div class="meta">
                    <span class="status">${stateName}</span>
                    <span class="priority">Priority: ${priorityText}</span>
                  </div>
                  
                  <div class="info-row">
                    <span class="label">Team:</span> ${issueDetails.team?.name || "Unassigned"}
                  </div>
                  
                  <div class="info-row">
                    <span class="label">Assignee:</span> ${issueDetails.assignee?.name || "Unassigned"}
                  </div>
                  
                  <div class="info-row">
                    <span class="label">Created by:</span> ${issueDetails.creator?.name || "Unknown"}
                  </div>

                  <div class="info-row">
                    <span class="label">Created:</span> ${new Date(issueDetails.issue.createdAt).toLocaleString()}
                  </div>

                  ${issueDetails.issue.updatedAt ? 
                    `<div class="info-row">
                      <span class="label">Updated:</span> ${new Date(issueDetails.issue.updatedAt).toLocaleString()}
                    </div>` : ''
                  }
                  
                  ${issueDetails.issue.estimate ? 
                    `<div class="info-row">
                      <span class="label">Estimate:</span> ${issueDetails.issue.estimate}
                    </div>` : ''
                  }
                  
                  <h2>Description</h2>
                  <div class="desc">${issueDetails.issue.description || "No description provided."}</div>
                  
                  ${issueDetails.subscribers && issueDetails.subscribers.length > 0 ? 
                    `<h2>Subscribers</h2>
                    <div class="subscribers">
                      ${issueDetails.subscribers.map(sub => `<div class="subscriber">${sub.name}</div>`).join('')}
                    </div>` : ''
                  }
                  
                  ${issueDetails.comments && issueDetails.comments.length > 0 ? 
                    `<h2>Comments</h2>
                    <div class="comments-list">
                      ${await Promise.all(issueDetails.comments.map(async comment => {
                        // Get author name properly
                        let authorName = 'System';
                        try {
                          const user = await comment.user;
                          if (user) {
                            authorName = user.name || 'Unknown User';
                          }
                        } catch (err) {
                          console.log('Error getting comment author:', err);
                        }
                        
                        return `
                          <div class="comment">
                            <div class="comment-header">
                              <span class="comment-author">${authorName}</span>
                              <span class="comment-date">${new Date(comment.createdAt).toLocaleString()}</span>
                            </div>
                            <div class="comment-body">${comment.body}</div>
                          </div>
                        `;
                      }))}
                    </div>` : ''
                  }
                  
                  <div class="actions">
                    <button id="openInBrowser">Open in Browser</button>
                    <button id="copyId">Copy ID</button>
                    <button id="copyBranchName">Copy Branch Name</button>
                  </div>
                </div>
                
                <script>
                  const vscode = acquireVsCodeApi();
                  document.getElementById('openInBrowser').addEventListener('click', () => {
                    vscode.postMessage({
                      command: 'openInBrowser',
                      url: '${issueDetails.issue.url}'
                    });
                  });
                  
                  document.getElementById('copyId').addEventListener('click', () => {
                    vscode.postMessage({
                      command: 'copyId',
                      id: '${issueDetails.issue.identifier}'
                    });
                  });
                  
                  document.getElementById('copyBranchName').addEventListener('click', () => {
                    vscode.postMessage({
                      command: 'copyBranchName',
                      branchName: '${issueDetails.issue.branchName}'
                    });
                  });
                </script>
              </body>
              </html>
            `;
            
            // Handle messages from the webview
            panel.webview.onDidReceiveMessage(
              async message => {
                switch (message.command) {
                  case 'openInBrowser':
                    vscode.env.openExternal(vscode.Uri.parse(message.url));
                    break;
                  case 'copyId':
                    await vscode.env.clipboard.writeText(message.id);
                    vscode.window.showInformationMessage(`Copied ID ${message.id} to clipboard!`);
                    break;
                  case 'copyBranchName':
                    await vscode.env.clipboard.writeText(message.branchName);
                    vscode.window.showInformationMessage(`Copied branch name ${message.branchName} to clipboard!`);
                    break;
                }
              },
              undefined,
              context.subscriptions
            );
            
            return issueDetails;
          } catch (error) {
            console.error("Error fetching issue details:", error);
            vscode.window.showErrorMessage("Failed to fetch issue details");
            return null;
          }
        }
      );
    }
  );
  context.subscriptions.push(getContextIssueDetailsDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
