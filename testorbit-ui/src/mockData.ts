import { TestCase, ExecutionResult, ActivityItem, BugReport } from "./types";

export const mockTestCases: TestCase[] = [
  {
    id: "TC-001", title: "Verify successful user login with valid credentials",
    preconditions: ["User account exists and is active", "User is on the login page"],
    steps: ["Navigate to login page", "Enter valid email", "Enter valid password", "Click Login"],
    expectedResult: "User is redirected to dashboard with welcome message",
    postConditions: ["User session is active"], testData: "Email: <valid_email>, Password: <valid_password>",
    priority: "High", type: "Smoke", scope: "Positive", userStoryId: "PROJ-101"
  },
  {
    id: "TC-002", title: "Verify login fails with invalid password",
    preconditions: ["User account exists"],
    steps: ["Navigate to login page", "Enter valid email", "Enter incorrect password", "Click Login"],
    expectedResult: "Error message 'Invalid credentials' is displayed",
    postConditions: [], testData: "Email: <valid_email>, Password: <wrong_password>",
    priority: "High", type: "Regression", scope: "Negative", userStoryId: "PROJ-101"
  },
  {
    id: "TC-003", title: "Verify login with empty email field",
    preconditions: ["User is on login page"],
    steps: ["Leave email field empty", "Enter any password", "Click Login"],
    expectedResult: "Validation error 'Email is required' is shown",
    postConditions: [], testData: "",
    priority: "Medium", type: "Regression", scope: "Edge", userStoryId: "PROJ-101"
  },
  {
    id: "TC-004", title: "Verify login with maximum length password",
    preconditions: ["User account exists"],
    steps: ["Navigate to login page", "Enter valid email", "Enter 256-character password", "Click Login"],
    expectedResult: "System handles input without crash; appropriate error shown",
    postConditions: [], testData: "Password: 256-char string",
    priority: "Low", type: "Functional", scope: "Edge", userStoryId: "PROJ-101"
  },
  {
    id: "TC-005", title: "Verify password reset link is sent to registered email",
    preconditions: ["User account exists with valid email"],
    steps: ["Click Forgot Password", "Enter registered email", "Click Send Reset Link"],
    expectedResult: "Success message shown; reset email delivered within 2 minutes",
    postConditions: ["Reset token is valid for 24h"], testData: "Email: <registered_email>",
    priority: "High", type: "Functional", scope: "Positive", userStoryId: "PROJ-102"
  }
];

export const mockExecutionResults: ExecutionResult[] = [
  { testCaseId: "TC-001", actualResult: "User redirected to dashboard successfully", status: "Pass" },
  { testCaseId: "TC-002", actualResult: "No error message displayed; user logged in", status: "Fail" },
  { testCaseId: "TC-003", actualResult: "Validation error shown as expected", status: "Pass" },
  { testCaseId: "TC-004", actualResult: "Pending", status: "Pending" },
  { testCaseId: "TC-005", actualResult: "Pending", status: "Pending" }
];

export const mockActivity: ActivityItem[] = [
  { id: "1", action: "Pushed", target: "TC-001, TC-002, TC-003", user: "qa.engineer@org.com", timestamp: "2025-01-15 14:32", type: "push" },
  { id: "2", action: "Created Bug", target: "BUG-045 — Login bypass on invalid password", user: "qa.engineer@org.com", timestamp: "2025-01-15 15:10", type: "bug" },
  { id: "3", action: "Executed", target: "Test Plan TP-2025-01", user: "qa.lead@org.com", timestamp: "2025-01-15 16:00", type: "execution" },
  { id: "4", action: "Generated", target: "5 test cases for PROJ-101", user: "qa.engineer@org.com", timestamp: "2025-01-15 13:00", type: "test" }
];

export const mockBug: BugReport = {
  title: "Login bypass — invalid password does not trigger error",
  description: "When a user enters an incorrect password, the system logs them in instead of displaying an error message. This is a critical security defect.",
  steps: ["Navigate to login page", "Enter valid registered email", "Enter incorrect password", "Click Login button"],
  expectedResult: "Error message 'Invalid credentials' is displayed and login is blocked",
  actualResult: "No error message displayed; user logged in successfully with wrong password",
  severity: "Critical",
  testCaseId: "TC-002",
  userStoryId: "PROJ-101"
};
