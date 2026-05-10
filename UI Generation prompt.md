You are a senior frontend engineer specializing in enterprise SaaS applications.

Your task is to design and implement a clean, minimal, enterprise-grade UI for a QA automation platform called "TestOrbit AI".

---

TECH STACK REQUIREMENTS

* React with TypeScript
* Tailwind CSS
* Use a clean component-based architecture
* Prefer reusable components
* No unnecessary animations or flashy UI
* Focus on data clarity and usability

---

UI DESIGN PRINCIPLES

* Enterprise-grade (similar to Jira / TestRail / Zephyr)
* Minimal and functional
* Table-driven layout
* Clear separation of workflow phases
* Readable typography and spacing
* Consistent layout across pages

---

APPLICATION STRUCTURE

Create the following pages:

1. Dashboard
2. Test Case Generator
3. Execution
4. Repository

Include a sidebar navigation with:

* Dashboard
* Test Case Generator
* Execution
* Repository
* Settings

---

1. DASHBOARD PAGE

Include:

* Metrics cards:

  * Total Test Cases
  * Passed
  * Failed
  * Open Bugs

* Recent activity table

---

2. TEST CASE GENERATOR PAGE (CORE PAGE)

Top Section (Input Panel):

* Jira ID input field
* Fetch button
* Notes textarea
* Scope selection checkboxes:

  * Positive
  * Negative
  * Edge

Middle Section (Table):

Display generated test cases in a table with:

* Checkbox (select test case)
* Test Case ID
* Title
* Type (Smoke/Regression)
* Priority
* Edit button

Edit Behavior (IMPORTANT):

* Only one "Edit" button per row
* When clicked:

  * Entire row becomes editable
* No field-level editing outside edit mode

Bottom Actions:

* Generate Test Cases button
* Push Selected to Jira button

---

3. EXECUTION PAGE

Table with:

* Test Case ID
* Title
* Expected Result
* Actual Result (editable input)
* Status (Pass / Fail)
* Action column

Rules:

* Execution should not be allowed without actual result
* Status updates after evaluation

---

4. BUG CREATION (MODAL)

When a test case fails:

* Show "Create Bug" button

* On click:

  * Open modal
  * Display bug details:

    * Title
    * Description
    * Steps
    * Expected
    * Actual
    * Severity

* Include "Confirm" button to create bug

---

5. REPOSITORY PAGE

Layout:

Left Panel:

* Folder tree:

  * User Stories
  * Smoke
  * Regression
  * Releases (Test Plans)

Right Panel:

* Table of test cases

---

COMPONENT STRUCTURE

Create reusable components:

* Sidebar
* Header
* TestCaseTable
* EditableRow
* BugModal
* InputForm

---

OUTPUT REQUIREMENTS

* Provide full React code
* Use functional components
* Use Tailwind for styling
* Keep code clean and modular
* No explanations, only code

---
