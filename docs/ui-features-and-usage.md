# DocSync UI Features and How to Use Them

This document lists all currently available UI features and usage steps.

## 1. Landing Page

How to use:
1. Open the app root URL.
2. Click Get Started or Sign In to move to authentication.

Reference:
- [frontend/src/App.tsx](frontend/src/App.tsx)

## 2. Authentication: Sign In and Create Account

How to use:
1. Open the Auth page.
2. Use Sign In tab for existing users.
3. Use Create Account tab for new users.
4. Use Remember me for longer session duration.
5. Use Forgot password to request a reset link.
6. If 2FA is enabled, complete the second step with your 6-digit code.

Reference:
- [frontend/src/components/pages/AuthPage.tsx](frontend/src/components/pages/AuthPage.tsx)

## 3. Email Verification

How to use:
1. Open the verification link that includes a token.
2. The Verify Email page validates token and confirms account.
3. Return to Sign In after success.

Reference:
- [frontend/src/components/pages/VerifyEmailPage.tsx](frontend/src/components/pages/VerifyEmailPage.tsx)

## 4. Password Reset

How to use:
1. From Auth page, click Forgot password.
2. Submit your email address.
3. Open reset link.
4. Enter new password and confirm password.
5. Submit and return to Sign In.

Reference:
- [frontend/src/components/pages/ResetPasswordPage.tsx](frontend/src/components/pages/ResetPasswordPage.tsx)

## 5. Workspace Home Dashboard

How to use:
1. After login, you land on Workspace page.
2. View document summaries and available templates.
3. Create a document from template or blank.
4. Open a document in editor mode or viewer mode.

Reference:
- [frontend/src/components/pages/WorkspaceHomePage.tsx](frontend/src/components/pages/WorkspaceHomePage.tsx)

## 6. Workspace Left Sidebar Tree

How to use:
1. Browse hierarchical document tree in left panel.
2. Expand or collapse parent nodes.
3. Search to filter documents.
4. Double-click a document to open in viewer page.
5. Use context actions and drag/drop organization where available.

Reference:
- [frontend/src/components/pages/WorkspaceHomePage.tsx](frontend/src/components/pages/WorkspaceHomePage.tsx)

## 7. Editor Page (Canvas-Based)

How to use:
1. Open a document in editor route.
2. Edit title and content on canvas.
3. Use toolbar options for formatting, font, color, page size, and history.
4. Save and publish through editor actions.

Reference:
- [frontend/src/App.tsx](frontend/src/App.tsx#L80)

## 8. Collapsible Editor Workspace Panel

How to use:
1. Use collapse/expand control in editor left panel.
2. Switch between compact rail and expanded navigation.
3. Select documents from panel for quick switching.

Reference:
- [frontend/src/App.tsx](frontend/src/App.tsx#L80)

## 9. Viewer Page (Read Mode)

How to use:
1. Open document from workspace left panel with double-click.
2. Read content in non-edit mode.
3. See title and modified metadata in canvas view.
4. Use Back To Workspace button to return.

Reference:
- [frontend/src/App.tsx](frontend/src/App.tsx#L966)

## 10. Comments Tool

How to use:
1. Open Comments from right-side tools in editor.
2. Add and review comments for current document.

Reference:
- [frontend/src/components/Comments.tsx](frontend/src/components/Comments.tsx)

## 11. Saved Documents and Version History

How to use:
1. Open Saved Documents tool from editor right panel.
2. View saved versions/snapshots.
3. Restore older versions when needed.

Reference:
- [frontend/src/components/VersionHistory.tsx](frontend/src/components/VersionHistory.tsx)

## 12. To-Do List Tool

How to use:
1. Open To-Do tool in editor side panel.
2. Add checklist items linked to current document.
3. Mark tasks complete/incomplete.

Reference:
- [frontend/src/components/TodoList.tsx](frontend/src/components/TodoList.tsx)

## 13. Grammar Checker Tool

How to use:
1. Open Grammar Checker from right tools.
2. Run checks and review issue suggestions.

Reference:
- [frontend/src/components/GrammarChecker.tsx](frontend/src/components/GrammarChecker.tsx)

## 14. AI Assistant Tool

How to use:
1. Open AI Assistant in right tools.
2. Ask writing and content improvement questions.

Reference:
- [frontend/src/components/AiTool.tsx](frontend/src/components/AiTool.tsx)

## 15. Security Center

How to use:
1. Open Security page from workspace/profile path.
2. Review account status:
   - Email verification status
   - 2FA status
   - Active sessions count
3. Set up 2FA:
   - Click Set up 2FA
   - Scan QR with authenticator app
   - Enter code and confirm
4. Disable 2FA by entering valid code.
5. Session management:
   - Revoke single session
   - Revoke all sessions
6. Audit activity:
   - Review security events and statuses

Reference:
- [frontend/src/components/pages/SecuritySettingsPage.tsx](frontend/src/components/pages/SecuritySettingsPage.tsx)

## 16. Session Restore and Auto Refresh

How to use:
1. Reload app to test secure session restoration.
2. App refreshes token before access token expiry.
3. If refresh fails, app returns user to Auth page.
4. Logout clears session and redirects to Auth.

Reference:
- [frontend/src/App.tsx](frontend/src/App.tsx#L1304)

## 17. Editor Features (Detailed)

How to use:
1. Rich text editing on canvas:
   - Type directly in the editor area.
2. Title editing:
   - Change document title from the top title input.
3. Save and Publish:
   - Click Save for snapshot/save-message flow.
   - Click Publish for publish action.
4. Page size:
   - Choose Responsive, A3, A4, or A5 from toolbar.
5. Fullscreen mode:
   - Toggle fullscreen from toolbar icon.
6. Undo and redo:
   - Use toolbar history controls.
7. Text formatting:
   - Bold, italic, underline, text color, highlight.
8. Typography controls:
   - Select text preset, font family, and font size.
9. Lists and spacing:
   - Toggle bullet/number list, adjust indent.
   - Set line spacing, toggle space-before/space-after line.
10. Link insertion:
   - Use link action and provide URL.
11. Image insertion and image options:
   - Insert image from file.
   - For selected image: align, width, rotation, wrap mode, break layout, alt text.
12. Format painter and clear formatting:
   - Copy text format and apply to another selection.
   - Clear formatting on selected text.
13. Context menu and quick formatting:
   - Right-click in canvas for context menu actions.
14. Left workspace chapter panel inside editor:
   - Search chapters, filter by workspace, and navigate docs.
   - Collapse or expand panel for writing space.
15. Right-side editor utility strip:
   - Open Comments, Saved Documents, To-Do, Grammar Checker, and AI Assistant.

Reference:
- [frontend/src/App.tsx](frontend/src/App.tsx#L80)
- [frontend/src/components/toolbar/Toolbar.tsx](frontend/src/components/toolbar/Toolbar.tsx)
- [frontend/src/components/editor/RichEditor.tsx](frontend/src/components/editor/RichEditor.tsx)
- [frontend/src/components/editor/CanvasContextMenu.tsx](frontend/src/components/editor/CanvasContextMenu.tsx)

## Quick Demo Flow

1. Create account.
2. Verify email.
3. Sign in.
4. Open workspace and create/open document.
5. Use editor tools (comments, todo, grammar, AI).
6. Open Security Center, review sessions and logs.
7. Revoke one session and confirm behavior.
