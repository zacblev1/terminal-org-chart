# Terminal Org Chart

Terminal Org Chart is a command-line application built with Node.js that allows you to create, manage, and visualize an organization's hierarchical structure directly from your terminal. This tool provides an interactive menu to add, edit, remove, search, and print detailed reports of your organization's chart.

## Features

- **Create New Org Chart:** Initialize your organization by setting the CEO/root.
- **Add Employees:** Input employee details including name, title, LOB (Line of Business), division, department, and email.
- **Edit Employee Details:** Update an employee’s information dynamically.
- **Remove Employees:** Remove an employee and reassign their direct reports as needed.
- **Display Org Chart:** Visualize your entire organization hierarchy in the terminal.
- **Search Functionality:** Quickly find employees by name, title, LOB, division, department, or email.
- **Export/Import JSON:** Save your org chart to a JSON file and load it later.
- **Print Reports:** Generate detailed reports including:
  - Complete organization chart
  - Department/Manager subtrees
  - Employee directories
  - Organizational statistics

## Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/zacblev1/terminal-org-chart.git
   ```

2. **Navigate into the project directory:**

   ```bash
   cd terminal-org-chart
   ```

3. **Install dependencies:**

   ```bash
   npm install
   ```

## Usage

Run the application using Node.js:

```bash
node index.js
```

Once the application starts, you’ll see an interactive menu with options to create a new org chart, add/edit/remove employees, display the org chart, search for employees, and print various reports. Simply follow the on-screen prompts to manage your organization.

## Dependencies

- **[chalk](https://www.npmjs.com/package/chalk):** Used for styling terminal output.
- **[inquirer](https://www.npmjs.com/package/inquirer):** Handles interactive command-line prompts.
- Node.js built-in modules: `fs`, `path`

## Contributing

Contributions are welcome! Feel free to fork the repository, open issues, or submit pull requests to help improve the project.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Thanks to the developers of [chalk](https://github.com/chalk/chalk) and [inquirer](https://github.com/SBoudrias/Inquirer.js) for their fantastic libraries that make this project possible.
```
