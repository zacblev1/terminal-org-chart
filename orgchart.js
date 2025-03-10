#!/usr/bin/env node

const chalk = require('chalk');
const inquirer = require('inquirer');
const fs = require('fs').promises;  // Async FS
const path = require('path');

const { v4: uuidv4 } = require('uuid'); // For unique employee IDs
const Fuse = require('fuse.js');        // For fuzzy search
const Papa = require('papaparse');      // For CSV parsing

// ===========================
// Employee Class
// ===========================
class Employee {
  constructor(
    name,
    title,
    lob = '',
    division = '',
    dept = '',
    email = '',
    manager = null
  ) {
    // Generate a fresh UUID by default; it can be overwritten if we have one
    this.id = uuidv4();
    this.name = name;
    this.title = title;
    this.lob = lob;
    this.division = division;
    this.dept = dept;
    this.email = email;
    this.manager = manager;
    this.reports = [];

    // If there's a manager, level is manager's level + 1
    // Otherwise, it's top-level (0)
    this.level = manager ? manager.level + 1 : 0;
  }

  // Add a direct report to this employee
  addReport(employee) {
    employee.manager = this;
    employee.level = this.level + 1;
    this.reports.push(employee);
    return this;
  }
}

// ===========================
// OrgChart Class
// ===========================
class OrgChart {
  constructor() {
    this.root = null;        // CEO or top-level employee
    this.employees = {};     // Map of ID -> Employee
    this.history = [];       // For Undo
    this.future = [];        // For Redo
  }

  // --------------------------------------------------
  //                   Undo/Redo
  // --------------------------------------------------
  pushState() {
    const snapshot = this._serializeOrg();
    this.history.push(snapshot);
    // Clear "redo" stack on each new action
    this.future = [];
  }

  undo() {
    if (this.history.length < 2) {
      console.log(chalk.yellow('Nothing to undo.'));
      return false;
    }

    // Pop the current state, push to future
    const current = this.history.pop();
    this.future.push(current);

    // The previous item is now our active state
    const previous = this.history[this.history.length - 1];
    this._loadSnapshot(previous);

    console.log(chalk.green('Undo successful.'));
    return true;
  }

  redo() {
    if (this.future.length === 0) {
      console.log(chalk.yellow('Nothing to redo.'));
      return false;
    }

    // Pop from future, push to history
    const snapshot = this.future.pop();
    this.history.push(snapshot);
    this._loadSnapshot(snapshot);

    console.log(chalk.green('Redo successful.'));
    return true;
  }

  // Convert the entire org to a JSON string
  _serializeOrg() {
    return JSON.stringify(this._prepareForExport(), null, 2);
  }

  // Load a given JSON snapshot (reverse of _serializeOrg)
  _loadSnapshot(snapshot) {
    const orgObj = JSON.parse(snapshot);
    this.employees = {};
    this._recreateFromJSON(orgObj);
  }

  // --------------------------------------------------
  //                   Basic Methods
  // --------------------------------------------------
  setRoot(employee) {
    this.root = employee;
    this.employees[employee.id] = employee;
    // Push initial state
    this.pushState();
  }

  addEmployee(name, title, managerId, lob, division, dept, email) {
    if (!this.root) {
      console.log(chalk.red('No CEO/root exists. Create a new org chart first.'));
      return null;
    }

    // Save snapshot before modifying
    this.pushState();

    // Find the manager by ID; fallback to root if none
    let manager = this.employees[managerId];
    if (!manager) {
      manager = this.root;
    }

    const employee = new Employee(name, title, lob, division, dept, email, manager);
    manager.addReport(employee);
    this.employees[employee.id] = employee;

    console.log(chalk.green(`Employee "${name}" added under "${manager.name}"`));
    return employee;
  }

  removeEmployee(employeeId, newManagerId = null) {
    // Block removing the root
    if (this.root && this.root.id === employeeId) {
      console.log(chalk.red('Cannot remove the root (CEO).'));
      return false;
    }

    const employee = this.employees[employeeId];
    if (!employee) {
      console.log(chalk.red('Employee not found.'));
      return false;
    }

    this.pushState();

    // Reassign direct reports if requested
    if (newManagerId && this.employees[newManagerId]) {
      const newManager = this.employees[newManagerId];
      employee.reports.forEach((r) => {
        newManager.addReport(r);
      });
    } else {
      // If no reassignment, we detach them
      employee.reports.forEach((r) => {
        r.manager = null;
      });
    }

    // Remove from the old manager's reports
    if (employee.manager) {
      employee.manager.reports = employee.manager.reports.filter((r) => r.id !== employee.id);
    }

    // Remove from the main dictionary
    delete this.employees[employeeId];

    console.log(chalk.green(`Removed "${employee.name}".`));
    return true;
  }

  editEmployee(employeeId, newData) {
    const employee = this.employees[employeeId];
    if (!employee) {
      console.log(chalk.red(`Employee with ID "${employeeId}" not found.`));
      return false;
    }

    this.pushState();

    // Update fields if present
    if (typeof newData.name === 'string') {
      employee.name = newData.name.trim() || employee.name;
    }
    if (typeof newData.title === 'string') {
      employee.title = newData.title.trim() || employee.title;
    }
    if (typeof newData.lob === 'string') {
      employee.lob = newData.lob.trim() || employee.lob;
    }
    if (typeof newData.division === 'string') {
      employee.division = newData.division.trim() || employee.division;
    }
    if (typeof newData.dept === 'string') {
      employee.dept = newData.dept.trim() || employee.dept;
    }
    if (typeof newData.email === 'string') {
      employee.email = newData.email.trim() || employee.email;
    }

    console.log(chalk.green(`Employee "${employee.name}" updated.`));
    return true;
  }

  moveSubtree(employeeId, newManagerId) {
    const employee = this.employees[employeeId];
    const newManager = this.employees[newManagerId];
    if (!employee || !newManager) {
      console.log(chalk.red('Invalid employee or manager ID.'));
      return false;
    }

    if (employee === this.root) {
      console.log(chalk.red('Cannot move the root (CEO).'));
      return false;
    }

    // Check if newManager is a descendant of employee to prevent cycles
    if (employee.id === newManager.id || this._isDescendant(employee, newManager)) {
      console.log(chalk.red('Cannot reassign to a subordinate or self.'));
      return false;
    }

    this.pushState();

    // 1) Remove the employee from the old manager's reports
    if (employee.manager) {
      employee.manager.reports = employee.manager.reports.filter((r) => r.id !== employee.id);
    }

    // 2) Attach to new manager
    newManager.addReport(employee);

    // 3) Update levels in the subtree
    this._updateLevels(employee, newManager.level + 1);

    console.log(chalk.green(`Moved "${employee.name}" under "${newManager.name}".`));
    return true;
  }

  // Check if 'candidate' is somewhere in 'root's subtree, by comparing IDs
  _isDescendant(root, candidate) {
    for (const r of root.reports) {
      // Compare IDs to accommodate re-created objects
      if (r.id === candidate.id) return true;
      if (this._isDescendant(r, candidate)) return true;
    }
    return false;
  }

  _updateLevels(node, level) {
    node.level = level;
    node.reports.forEach((r) => this._updateLevels(r, level + 1));
  }

  // Return the chain of managers up to root
  getPath(employeeId) {
    const path = [];
    let current = this.employees[employeeId];
    while (current) {
      path.unshift(current);
      current = current.manager;
    }
    return path;
  }

  // --------------------------------------------------
  //                    Searching
  // --------------------------------------------------
  search(query) {
    const employeesArray = Object.values(this.employees);
    const fuse = new Fuse(employeesArray, {
      keys: ['name', 'title', 'lob', 'division', 'dept', 'email'],
      includeScore: true,
      threshold: 0.3
    });
    const results = fuse.search(query);
    return results.map((r) => r.item);
  }

  // --------------------------------------------------
  //                    Printing
  // --------------------------------------------------
  print() {
    if (!this.root) {
      console.log(chalk.red('Organization chart is empty. Add a CEO first.'));
      return;
    }
    this._printNode(this.root, '', true);
  }

  _printNode(node, prefix, isTail) {
    const connector = isTail ? '└── ' : '├── ';
    console.log(
      `${prefix}${connector}${chalk.green(node.name)} ${chalk.blue(`(${node.title})`)}`
    );
    const childPrefix = prefix + (isTail ? '    ' : '│   ');
    node.reports.forEach((report, idx) => {
      this._printNode(report, childPrefix, idx === node.reports.length - 1);
    });
  }

  // Print a subtree (plain text)
  printSubtree(employee) {
    this._printSubtree(employee, '', true);
  }

  _printSubtree(node, prefix, isTail) {
    const connector = isTail ? '└── ' : '├── ';
    console.log(`${prefix}${connector}${node.name} (${node.title})`);
    const childPrefix = prefix + (isTail ? '    ' : '│   ');
    node.reports.forEach((report, idx) => {
      this._printSubtree(report, childPrefix, idx === node.reports.length - 1);
    });
  }

  // --------------------------------------------------
  //               Export / Import (JSON)
  // --------------------------------------------------
  async exportToJSON(filename) {
    if (!this.root) {
      console.log(chalk.red('No org chart to export.'));
      return;
    }
    try {
      const data = JSON.stringify(this._prepareForExport(), null, 2);
      await fs.writeFile(filename, data, 'utf8');
      console.log(chalk.green(`Org chart exported to ${filename}`));
    } catch (err) {
      console.log(chalk.red(`Error exporting: ${err.message}`));
    }
  }

  _prepareForExport() {
    const serializeNode = (node) => ({
      id: node.id,
      name: node.name,
      title: node.title,
      lob: node.lob,
      division: node.division,
      dept: node.dept,
      email: node.email,
      level: node.level,
      reports: node.reports.map(serializeNode)
    });
    return serializeNode(this.root);
  }

  async importFromJSON(filename) {
    try {
      const data = await fs.readFile(filename, 'utf8');
      const obj = JSON.parse(data);
      this.employees = {};

      this._recreateFromJSON(obj);

      // After successful import, push a new snapshot
      this.pushState();
      console.log(chalk.green(`Org chart imported from ${filename}`));
      return true;
    } catch (err) {
      console.error(chalk.red(`Error importing org chart: ${err.message}`));
      return false;
    }
  }

  _recreateFromJSON(obj, manager = null) {
    const employee = new Employee(
      obj.name,
      obj.title,
      obj.lob,
      obj.division,
      obj.dept,
      obj.email,
      manager
    );
    // Overwrite the auto-generated ID with the original
    employee.id = obj.id;
    // Overwrite the level (optional, or we can recalc)
    employee.level = obj.level;

    this.employees[employee.id] = employee;

    if (!manager) {
      this.root = employee;
    } else {
      manager.reports.push(employee);
    }

    if (obj.reports && Array.isArray(obj.reports)) {
      obj.reports.forEach((child) => {
        this._recreateFromJSON(child, employee);
      });
    }
    return employee;
  }

  // --------------------------------------------------
  //               CSV Import (Improved)
  // --------------------------------------------------
  /**
   * CSV must have columns:
   *   name, title, managerName, lob, division, dept, email
   * We do a multi-pass approach to ensure that employees
   * can be added only after their manager exists.
   */
  async importFromCSV(filename) {
    try {
      const fileData = await fs.readFile(filename, 'utf8');
      const parsed = Papa.parse(fileData, { header: true });
      const rows = parsed.data;

      if (!rows || !rows.length) {
        console.log(chalk.yellow('CSV file is empty or invalid format.'));
        return false;
      }

      this.pushState(); // Snapshot before bulk import

      // Convert rows to a normalized array
      let pending = rows.map((row) => ({
        name: row.name?.trim() || '',
        title: row.title?.trim() || '',
        managerName: row.managerName?.trim() || '',
        lob: row.lob?.trim() || '',
        division: row.division?.trim() || '',
        dept: row.dept?.trim() || '',
        email: row.email?.trim() || ''
      }));

      // We'll keep looping until we can't add any more or we've exhausted the list
      let addedAny = true;
      while (pending.length && addedAny) {
        addedAny = false;

        for (let i = pending.length - 1; i >= 0; i--) {
          const { name, title, managerName, lob, division, dept, email } = pending[i];
          if (!name || !title) {
            // Invalid row, remove it
            pending.splice(i, 1);
            continue;
          }

          let managerId = null;

          // If we have a managerName, try to find them by name
          if (managerName) {
            const manager = Object.values(this.employees).find(
              (emp) => emp.name.toLowerCase() === managerName.toLowerCase()
            );

            // If the manager is not yet in the org, skip for now
            if (!manager) {
              continue;
            }
            managerId = manager.id;
          }

          // If managerName is empty or not found, default to root
          if (!managerName || !managerId) {
            managerId = this.root ? this.root.id : null;
          }

          // Add the employee
          this.addEmployee(name, title, managerId, lob, division, dept, email);
          // Remove from pending
          pending.splice(i, 1);
          addedAny = true;
        }
      }

      // If any rows remain, their managers were never found
      if (pending.length > 0) {
        console.log(
          chalk.red(
            `Unable to import ${pending.length} row(s) because their manager(s) were not found or invalid.`
          )
        );
      }

      const importedCount = rows.length - pending.length;
      console.log(
        chalk.green(`Imported from CSV: ${importedCount} row(s) processed, ${pending.length} could not be imported.`)
      );
      return true;
    } catch (err) {
      console.error(chalk.red(`Error importing CSV: ${err.message}`));
      return false;
    }
  }
}

// ===========================
// OrgChartApp Class (CLI)
// ===========================
class OrgChartApp {
  constructor() {
    this.orgChart = new OrgChart();
    this.currentFile = null; // track the currently loaded JSON
  }

  async run() {
    console.log(chalk.bold.green('Welcome to Terminal Org Chart!'));

    let running = true;
    while (running) {
      running = await this.mainMenu();
    }

    console.log(chalk.bold.green('Thank you for using Terminal Org Chart!'));
  }

  async mainMenu() {
    console.clear();
    console.log(chalk.bold.cyan('===== Terminal Org Chart ====='));

    if (this.currentFile) {
      console.log(chalk.italic(`Current file: ${this.currentFile}`));
    }

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: 'Create a new org chart (set a CEO)', value: 'new' },
          { name: 'Add an employee', value: 'add' },
          { name: 'Edit an employee', value: 'edit' },
          { name: 'Move a subtree (reassign a manager)', value: 'move' },
          { name: 'Remove an employee', value: 'remove' },
          { name: 'Display org chart', value: 'display' },
          { name: 'Search employees (fuzzy)', value: 'search' },
          { name: 'Undo last action', value: 'undo' },
          { name: 'Redo last undone action', value: 'redo' },
          { name: 'Save org chart (JSON)', value: 'save' },
          { name: 'Load org chart (JSON)', value: 'load' },
          { name: 'Import from CSV', value: 'importCSV' },
          { name: 'Print various reports', value: 'printMenu' },
          { name: 'Exit', value: 'exit' }
        ]
      }
    ]);

    switch (action) {
      case 'new':
        await this.createNewOrgChart();
        break;
      case 'add':
        await this.addEmployee();
        break;
      case 'edit':
        await this.editEmployee();
        break;
      case 'move':
        await this.moveSubtree();
        break;
      case 'remove':
        await this.removeEmployee();
        break;
      case 'display':
        this.displayOrgChart();
        break;
      case 'search':
        await this.searchEmployees();
        break;
      case 'undo':
        this.orgChart.undo();
        break;
      case 'redo':
        this.orgChart.redo();
        break;
      case 'save':
        await this.saveOrgChart();
        break;
      case 'load':
        await this.loadOrgChart();
        break;
      case 'importCSV':
        await this.importFromCSV();
        break;
      case 'printMenu':
        await this.printMenu();
        break;
      case 'exit':
        return false;
    }

    if (action !== 'exit') {
      // Pause before returning to main menu
      await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continue',
          message: 'Press Enter to continue...',
          default: true
        }
      ]);
      return true;
    }
    return false;
  }

  // --------------------------------------------------
  //              Org Chart Functions
  // --------------------------------------------------
  async createNewOrgChart() {
    console.clear();
    console.log(chalk.bold.yellow('Create a New Org Chart'));

    const { name, title, lob, division, dept, email } = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Enter the name of the CEO/root:',
        validate: (input) => input.trim() !== '' || 'Name cannot be empty'
      },
      {
        type: 'input',
        name: 'title',
        message: 'Enter their title:',
        validate: (input) => input.trim() !== '' || 'Title cannot be empty'
      },
      {
        type: 'input',
        name: 'lob',
        message: 'Enter LOB (Line of Business):',
        default: ''
      },
      {
        type: 'input',
        name: 'division',
        message: 'Enter Division:',
        default: ''
      },
      {
        type: 'input',
        name: 'dept',
        message: 'Enter Department:',
        default: ''
      },
      {
        type: 'input',
        name: 'email',
        message: 'Enter Email:',
        default: ''
      }
    ]);

    // Reset the org
    this.orgChart = new OrgChart();
    const ceo = new Employee(name, title, lob, division, dept, email, null);
    this.orgChart.setRoot(ceo);
    this.currentFile = null;

    console.log(chalk.green(`Created a new org chart with ${name} as the root`));
  }

  async addEmployee() {
    if (!this.orgChart.root) {
      console.log(chalk.red('Please create a new org chart first.'));
      return;
    }
    console.clear();
    console.log(chalk.bold.yellow('Add an Employee'));

    // List all employees as potential managers
    const managerChoices = Object.values(this.orgChart.employees).map((e) => ({
      name: `${e.name} (${e.title})`,
      value: e.id
    }));

    const { name, title, managerId, lob, division, dept, email } =
      await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Enter the name of the employee:',
          validate: (input) => input.trim() !== '' || 'Name cannot be empty'
        },
        {
          type: 'input',
          name: 'title',
          message: 'Enter their title:',
          validate: (input) => input.trim() !== '' || 'Title cannot be empty'
        },
        {
          type: 'list',
          name: 'managerId',
          message: 'Select their manager:',
          choices: managerChoices
        },
        {
          type: 'input',
          name: 'lob',
          message: 'Enter LOB (Line of Business):',
          default: ''
        },
        {
          type: 'input',
          name: 'division',
          message: 'Enter Division:',
          default: ''
        },
        {
          type: 'input',
          name: 'dept',
          message: 'Enter Department:',
          default: ''
        },
        {
          type: 'input',
          name: 'email',
          message: 'Enter Email:',
          default: ''
        }
      ]);

    this.orgChart.addEmployee(name, title, managerId, lob, division, dept, email);
  }

  async editEmployee() {
    if (!this.orgChart.root) {
      console.log(chalk.red('Please create a new org chart first.'));
      return;
    }
    console.log(chalk.bold.yellow('Edit an Employee'));

    const employeeChoices = Object.values(this.orgChart.employees).map((e) => ({
      name: `${e.name} (${e.title})`,
      value: e.id
    }));

    if (employeeChoices.length === 0) {
      console.log(chalk.yellow('No employees to edit.'));
      return;
    }

    const { employeeId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'employeeId',
        message: 'Select the employee to edit:',
        choices: employeeChoices
      }
    ]);

    const employee = this.orgChart.employees[employeeId];
    if (!employee) {
      console.log(chalk.red('Employee not found.'));
      return;
    }

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: `Name [${employee.name}]:`,
        default: employee.name
      },
      {
        type: 'input',
        name: 'title',
        message: `Title [${employee.title}]:`,
        default: employee.title
      },
      {
        type: 'input',
        name: 'lob',
        message: `LOB (Line of Business) [${employee.lob}]:`,
        default: employee.lob
      },
      {
        type: 'input',
        name: 'division',
        message: `Division [${employee.division}]:`,
        default: employee.division
      },
      {
        type: 'input',
        name: 'dept',
        message: `Department [${employee.dept}]:`,
        default: employee.dept
      },
      {
        type: 'input',
        name: 'email',
        message: `Email [${employee.email}]:`,
        default: employee.email
      }
    ]);

    this.orgChart.editEmployee(employeeId, answers);
  }

  async moveSubtree() {
    if (!this.orgChart.root) {
      console.log(chalk.red('Please create a new org chart first.'));
      return;
    }
    console.log(chalk.bold.yellow('Move a Subtree'));

    // Cannot move the root, so filter it out
    const employeeChoices = Object.values(this.orgChart.employees)
      .filter((e) => e !== this.orgChart.root)
      .map((e) => ({
        name: `${e.name} (${e.title})`,
        value: e.id
      }));

    if (employeeChoices.length === 0) {
      console.log(chalk.yellow('No subtree to move (only the CEO exists).'));
      return;
    }

    const { employeeId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'employeeId',
        message: 'Select the employee (subtree root) to move:',
        choices: employeeChoices
      }
    ]);

    const managerChoices = Object.values(this.orgChart.employees)
      .filter((e) => e.id !== employeeId)
      .map((e) => ({
        name: `${e.name} (${e.title})`,
        value: e.id
      }));

    const { newManagerId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'newManagerId',
        message: 'Select the new manager:',
        choices: managerChoices
      }
    ]);

    this.orgChart.moveSubtree(employeeId, newManagerId);
  }

  async removeEmployee() {
    if (!this.orgChart.root) {
      console.log(chalk.red('Please create a new org chart first.'));
      return;
    }
    console.log(chalk.bold.yellow('Remove an Employee'));

    // Filter out the root from removal
    const employeeChoices = Object.values(this.orgChart.employees)
      .filter((e) => e !== this.orgChart.root)
      .map((e) => ({
        name: `${e.name} (${e.title})`,
        value: e.id
      }));

    if (employeeChoices.length === 0) {
      console.log(chalk.yellow('No employees to remove (only the CEO exists).'));
      return;
    }

    const { employeeId, reassignReports } = await inquirer.prompt([
      {
        type: 'list',
        name: 'employeeId',
        message: 'Select the employee to remove:',
        choices: employeeChoices
      },
      {
        type: 'confirm',
        name: 'reassignReports',
        message: 'Do you want to reassign their direct reports?',
        default: true
      }
    ]);

    let newManagerId = null;
    if (reassignReports) {
      // Choose a new manager for these direct reports
      const managerChoices = Object.values(this.orgChart.employees)
        .filter((e) => e.id !== employeeId)
        .map((e) => ({
          name: `${e.name} (${e.title})`,
          value: e.id
        }));

      const { managerId } = await inquirer.prompt([
        {
          type: 'list',
          name: 'managerId',
          message: 'Select the new manager for their direct reports:',
          choices: managerChoices
        }
      ]);
      newManagerId = managerId;
    }

    this.orgChart.removeEmployee(employeeId, newManagerId);
  }

  displayOrgChart() {
    console.clear();
    console.log(chalk.bold.yellow('Organization Chart'));
    this.orgChart.print();
  }

  async searchEmployees() {
    if (!this.orgChart.root) {
      console.log(chalk.red('Org chart is empty. Please create one first.'));
      return;
    }
    console.clear();
    console.log(chalk.bold.yellow('Search (Fuzzy) Employees'));

    const { query } = await inquirer.prompt([
      {
        type: 'input',
        name: 'query',
        message: 'Enter search term:',
        validate: (input) => input.trim() !== '' || 'Search term cannot be empty'
      }
    ]);

    const results = this.orgChart.search(query);
    if (!results.length) {
      console.log(chalk.yellow(`No matches found for "${query}".`));
      return;
    }

    console.log(chalk.green(`Found ${results.length} match(es):`));
    results.forEach((emp, idx) => {
      console.log(
        chalk.bold(`${idx + 1}. ${emp.name} (${emp.title}) - [ID: ${emp.id}]`)
      );
    });
  }

  // --------------------------------------------------
  //               File Operations
  // --------------------------------------------------
  async saveOrgChart() {
    if (!this.orgChart.root) {
      console.log(chalk.red('Nothing to save. Please create an org chart first.'));
      return;
    }

    console.clear();
    console.log(chalk.bold.yellow('Save Org Chart (JSON)'));

    const { filename } = await inquirer.prompt([
      {
        type: 'input',
        name: 'filename',
        message: 'Enter the filename to save:',
        default: this.currentFile || 'orgchart.json',
        validate: (input) => input.trim() !== '' || 'Filename cannot be empty'
      }
    ]);

    await this.orgChart.exportToJSON(filename);
    this.currentFile = filename;
  }

  async loadOrgChart() {
    console.clear();
    console.log(chalk.bold.yellow('Load Org Chart (JSON)'));

    let files = [];
    try {
      const dirFiles = await fs.readdir('./');
      files = dirFiles.filter((file) => file.endsWith('.json'));
    } catch (err) {
      console.error(chalk.red(`Error reading directory: ${err.message}`));
    }

    let choices = files.map((file) => ({ name: file, value: file }));
    choices.push({ name: 'Enter a different filename', value: 'custom' });

    const { fileChoice } = await inquirer.prompt([
      {
        type: 'list',
        name: 'fileChoice',
        message: 'Select a file to load:',
        choices: choices
      }
    ]);

    let filename = fileChoice;
    if (fileChoice === 'custom') {
      const { customFile } = await inquirer.prompt([
        {
          type: 'input',
          name: 'customFile',
          message: 'Enter the filename to load:',
          validate: (input) => input.trim() !== '' || 'Filename cannot be empty'
        }
      ]);
      filename = customFile;
    }

    const success = await this.orgChart.importFromJSON(filename);
    if (success) {
      this.currentFile = filename;
    }
  }

  async importFromCSV() {
    console.clear();
    console.log(chalk.bold.yellow('Import from CSV'));

    let files = [];
    try {
      const dirFiles = await fs.readdir('./');
      files = dirFiles.filter((file) => file.endsWith('.csv'));
    } catch (err) {
      console.error(chalk.red(`Error reading directory: ${err.message}`));
    }

    let choices = files.map((file) => ({ name: file, value: file }));
    choices.push({ name: 'Enter a different filename', value: 'custom' });

    const { fileChoice } = await inquirer.prompt([
      {
        type: 'list',
        name: 'fileChoice',
        message: 'Select a CSV file to import:',
        choices: choices
      }
    ]);

    let filename = fileChoice;
    if (fileChoice === 'custom') {
      const { customFile } = await inquirer.prompt([
        {
          type: 'input',
          name: 'customFile',
          message: 'Enter the CSV filename:',
          validate: (input) => input.trim() !== '' || 'Filename cannot be empty'
        }
      ]);
      filename = customFile;
    }

    await this.orgChart.importFromCSV(filename);
  }

  // --------------------------------------------------
  //                  Print Menu
  // --------------------------------------------------
  async printMenu() {
    if (!this.orgChart.root) {
      console.log(chalk.red('Org chart is empty. Please create one first.'));
      return;
    }

    console.clear();
    console.log(chalk.bold.yellow('Print Reports'));

    const { reportType } = await inquirer.prompt([
      {
        type: 'list',
        name: 'reportType',
        message: 'What type of report would you like to print?',
        choices: [
          { name: 'Complete Organization Chart', value: 'full' },
          { name: 'Subtree by Manager', value: 'subtree' },
          { name: 'Employee Directory', value: 'directory' },
          { name: 'Statistics Report', value: 'stats' },
          { name: 'Return to main menu', value: 'return' }
        ]
      }
    ]);

    switch (reportType) {
      case 'full':
        await this.printFullOrgChart();
        break;
      case 'subtree':
        await this.printSubtreeReport();
        break;
      case 'directory':
        await this.printEmployeeDirectory();
        break;
      case 'stats':
        await this.printStatisticsReport();
        break;
      default:
        break;
    }
  }

  async printFullOrgChart() {
    const { filename } = await inquirer.prompt([
      {
        type: 'input',
        name: 'filename',
        message: 'Enter filename to save the organization chart:',
        default: 'full_org_chart.txt',
        validate: (input) => input.trim() !== '' || 'Filename cannot be empty'
      }
    ]);

    let content = 'ORGANIZATION CHART\n==================\n\n';
    const oldLog = console.log;
    const logs = [];
    console.log = (...args) => logs.push(args.join(' '));

    this.orgChart.print();

    console.log = oldLog;

    content += logs.join('\n');
    content += `\n\nTotal Employees: ${Object.keys(this.orgChart.employees).length}\n`;
    content += `Generated on: ${new Date().toLocaleString()}\n`;

    await fs.writeFile(filename, content, 'utf8');
    console.log(chalk.green(`Organization chart saved to ${filename}`));
  }

  async printSubtreeReport() {
    const managers = Object.values(this.orgChart.employees).filter(
      (e) => e.reports.length > 0
    );
    if (!managers.length) {
      console.log(chalk.yellow('No managers with direct reports found.'));
      return;
    }

    const managerChoices = managers.map((m) => ({
      name: `${m.name} (${m.title}) - ${m.reports.length} direct reports`,
      value: m.id
    }));

    const { managerId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'managerId',
        message: 'Select a manager to print their subtree:',
        choices: managerChoices
      }
    ]);

    const manager = this.orgChart.employees[managerId];
    if (!manager) return;

    const { filename } = await inquirer.prompt([
      {
        type: 'input',
        name: 'filename',
        message: 'Enter filename to save the subtree:',
        default: `${manager.name.toLowerCase().replace(/\s+/g, '_')}_subtree.txt`,
        validate: (input) => input.trim() !== '' || 'Filename cannot be empty'
      }
    ]);

    let content = `SUBTREE FOR: ${manager.name}\n=======================\n\n`;
    const oldLog = console.log;
    const logs = [];
    console.log = (...args) => logs.push(args.join(' '));

    this.orgChart.printSubtree(manager);

    console.log = oldLog;

    content += logs.join('\n');
    content += `\n\nGenerated on: ${new Date().toLocaleString()}\n`;
    await fs.writeFile(filename, content, 'utf8');
    console.log(chalk.green(`Subtree saved to ${filename}`));
  }

  async printEmployeeDirectory() {
    const { filename } = await inquirer.prompt([
      {
        type: 'input',
        name: 'filename',
        message: 'Enter filename to save the employee directory:',
        default: 'employee_directory.txt',
        validate: (input) => input.trim() !== '' || 'Filename cannot be empty'
      }
    ]);

    let content = 'EMPLOYEE DIRECTORY\n==================\n\n';

    // Sort by name for a neat directory
    const sorted = Object.values(this.orgChart.employees).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    sorted.forEach((emp, idx) => {
      content += `${idx + 1}. ${emp.name} (${emp.title}) [ID: ${emp.id}]\n`;
      content += `   LOB: ${emp.lob}\n`;
      content += `   Division: ${emp.division}\n`;
      content += `   Department: ${emp.dept}\n`;
      content += `   Email: ${emp.email}\n`;
      if (emp.manager) {
        content += `   Reports to: ${emp.manager.name} (${emp.manager.title})\n`;
      } else {
        content += `   Reports to: None (CEO)\n`;
      }
      content += `   Direct reports: ${emp.reports.length || 'None'}\n\n`;
    });

    content += `Total Employees: ${sorted.length}\n`;
    content += `Generated on: ${new Date().toLocaleString()}\n`;

    await fs.writeFile(filename, content, 'utf8');
    console.log(chalk.green(`Employee directory saved to ${filename}`));
  }

  async printStatisticsReport() {
    const { filename } = await inquirer.prompt([
      {
        type: 'input',
        name: 'filename',
        message: 'Enter filename to save the statistics report:',
        default: 'org_statistics.txt',
        validate: (input) => input.trim() !== '' || 'Filename cannot be empty'
      }
    ]);

    const employees = Object.values(this.orgChart.employees);
    const totalEmployees = employees.length;

    // If no employees, skip
    if (!employees.length) {
      console.log(chalk.red('No employees to generate statistics on.'));
      return;
    }

    const maxLevel = Math.max(...employees.map((e) => e.level));
    // Count by level
    const employeesByLevel = new Array(maxLevel + 1).fill(0);
    employees.forEach((e) => {
      employeesByLevel[e.level]++;
    });

    // Count managers
    const managersCount = employees.filter((e) => e.reports.length > 0).length;
    const avgSpan = managersCount > 0 ? (totalEmployees - 1) / managersCount : 0;

    // Manager with the most direct reports
    let maxReports = 0;
    let managerWithMostReports = null;
    employees.forEach((e) => {
      if (e.reports.length > maxReports) {
        maxReports = e.reports.length;
        managerWithMostReports = e;
      }
    });

    // Individual contributors
    const individualContributors = employees.filter((e) => e.reports.length === 0);

    let content = `ORGANIZATION STATISTICS REPORT\n==============================\n\n`;
    content += `Total Employees: ${totalEmployees}\n`;
    content += `Organization Depth: ${maxLevel + 1} levels\n`;
    content += `Total Managers: ${managersCount}\n`;
    content += `Average Span of Control: ${avgSpan.toFixed(2)}\n\n`;

    content += `Employees by Level:\n`;
    employeesByLevel.forEach((count, level) => {
      content += `  Level ${level}: ${count} employee(s)${
        level === 0 ? ' (CEO level)' : ''
      }\n`;
    });
    content += '\n';

    if (managerWithMostReports) {
      content += `Manager with most direct reports:\n`;
      content += `  ${managerWithMostReports.name} (${managerWithMostReports.title}) => ${maxReports} reports\n\n`;
    }

    content += `Individual Contributors: ${individualContributors.length} (${(
      (individualContributors.length / totalEmployees) *
      100
    ).toFixed(1)}% of org)\n\n`;

    content += `Generated on: ${new Date().toLocaleString()}\n`;

    await fs.writeFile(filename, content, 'utf8');
    console.log(chalk.green(`Statistics report saved to ${filename}`));
  }
}

// ===========================
// Run the Application
// ===========================
(async () => {
  const app = new OrgChartApp();
  await app.run();
})();
