export type Priority = "High" | "Medium" | "Low";
export type TestType = "Smoke" | "Regression" | "Functional";
export type TestStatus = "Pass" | "Fail" | "Pending";
export type Severity = "Critical" | "High" | "Medium" | "Low";

export interface TestCase {
  id: string;
  title: string;
  preconditions: string[];
  steps: string[];
  expectedResult: string;
  postConditions: string[];
  testData: string;
  priority: Priority;
  type: TestType;
  scope: "Positive" | "Negative" | "Edge";
  userStoryId: string;
}

export interface ExecutionResult {
  testCaseId: string;
  actualResult: string;
  status: TestStatus;
}

export interface BugReport {
  title: string;
  description: string;
  steps: string[];
  expectedResult: string;
  actualResult: string;
  severity: Severity;
  testCaseId: string;
  userStoryId: string;
}

export interface ActivityItem {
  id: string;
  action: string;
  target: string;
  user: string;
  timestamp: string;
  type: "test" | "bug" | "execution" | "push";
}
