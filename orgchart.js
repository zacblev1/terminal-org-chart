#!/usr/bin/env node

const chalk = require('chalk');
const inquirer = require('inquirer');
// Register the fuzzy search for autocomplete
const Fuse = require('fuse.js');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Papa = require('papaparse');

// Define the Employee class to represent each node in the org chart
class Employee {
  constructor(
    name,
    title,
    level = 0,
    lob = '',
    division = '',
    dept = '',
    email = '',
    id = null
  ) {
    this.id = id || uuidv4();
    this.name = name;
    this.title = title;
    this.level = level;
    this.lob = lob;          // new
    this.division = division; // new
    this.dept = dept;        // new
    this.email = email;      // new
    this.reports = [];
  }

  // Add a direct report to this employee
  addReport(employee) {
    employee.level = this.level + 1;
    this.reports.push(employee);
    return this;
  }
}

// Class to handle the org chart operations
class OrgChart {
  constructor() {
    this.root = null;
    this.employees = {};
  }

  // Set the CEO/root of the organization
  setRoot(employee) {
    this.root = employee;
    this.employees[employee.name] = employee;
  }

  // Add an employee to the org chart
  addEmployee(name, title, managerName, lob, division, dept, email, id = null) {
    const employee = new Employee(name, title, 0, lob, division, dept, email, id);
    this.employees[name] = employee;

    if (managerName && this.employees[managerName]) {
      this.employees[managerName].addReport(employee);
    }

    return employee;
  }

  // Remove an employee and reassign their reports
  removeEmployee(name, newManagerName) {
    if (!this.employees[name]) return false;

    const employee = this.employees[name];
    const manager = this._findManager(name);

    // If there's a new manager, reassign reports
    if (newManagerName && this.employees[newManagerName]) {
      employee.reports.forEach((report) => {
        this.employees[newManagerName].addReport(report);
      });
    }

    // Remove employee from manager's reports
    if (manager) {
      manager.reports = manager.reports.filter((e) => e.name !== name);
    }

    // Remove employee from employees dictionary
    delete this.employees[name];
    return true;
  }

  // Find who manages a given employee
  _findManager(employeeName) {
    for (const name in this.employees) {
      const employee = this.employees[name];
      if (employee.reports.some((e) => e.name === employeeName)) {
        return employee;
      }
    }
    return null;
  }

  // Edit an employee’s details
  editEmployee(oldName, newData) {
    // Check if the employee exists
    if (!this.employees[oldName]) return false;

    // If name is being changed, we need to re-key in `this.employees`
    const employee = this.employees[oldName];

    // If the name changed, we also need to update the "employees" dictionary key
    if (newData.name && newData.name.trim() !== '' && newData.name !== oldName) {
      // Prevent overwriting if there's already someone with the new name
      if (this.employees[newData.name]) {
        throw new Error(`An employee named "${newData.name}" already exists!`);
      }

      // Remove the old key and set the new key
      delete this.employees[oldName];
      this.employees[newData.name] = employee;

      // If someone else was managing this employee, update the reference in manager.reports
      const manager = this._findManager(oldName);
      if (manager) {
        const idx = manager.reports.findIndex((r) => r.name === oldName);
        if (idx !== -1) {
          manager.reports[idx].name = newData.name;
        }
      }
    }

    // Update fields
    employee.name = newData.name ?? employee.name;
    employee.title = newData.title ?? employee.title;
    employee.lob = newData.lob ?? employee.lob;
    employee.division = newData.division ?? employee.division;
    employee.dept = newData.dept ?? employee.dept;
    employee.email = newData.email ?? employee.email;

    return true;
  }

  // Search for employees by ID, name, title, LOB, division, dept, or email
  search(query) {
    query = query.toLowerCase();
    const results = [];

    for (const name in this.employees) {
      const e = this.employees[name];
      // Add more match criteria as needed
      if (
        e.id.toLowerCase().includes(query) ||
        e.name.toLowerCase().includes(query) ||
        e.title.toLowerCase().includes(query) ||
        (e.lob && e.lob.toLowerCase().includes(query)) ||
        (e.division && e.division.toLowerCase().includes(query)) ||
        (e.dept && e.dept.toLowerCase().includes(query)) ||
        (e.email && e.email.toLowerCase().includes(query))
      ) {
        results.push(e);
      }
    }

    return results;
  }

  // Get an employee's full path from root (for org hierarchy)
  getPath(employeeName) {
    const path = [];
    let current = this.employees[employeeName];

    if (!current) return path;

    // Add the employee
    path.unshift(current);

    // Add all managers up to the root
    let manager = this._findManager(current.name);
    while (manager) {
      path.unshift(manager);
      manager = this._findManager(manager.name);
    }

    return path;
  }

  // Print the org chart in the terminal
  print() {
    if (!this.root) {
      console.log(chalk.red('Organization chart is empty. Add a CEO first.'));
      return;
    }

    console.log(chalk.bold('Organization Chart'));
    console.log(chalk.dim('─'.repeat(50)));

    this._printNode(this.root, '', true);
  }

  // Helper method to print a node and its subtree
  _printNode(node, prefix, isTail) {
    // Print current node
    const connector = isTail ? '└── ' : '├── ';
    
    // Standard text mode
    console.log(
      `${prefix}${connector}${chalk.green(node.name)} ${chalk.blue(`(${node.title})`)}`
    );

    // Prepare prefix for children
    const childPrefix = prefix + (isTail ? '    ' : '│   ');

    // Print children
    const lastIdx = node.reports.length - 1;
    node.reports.forEach((report, idx) => {
      this._printNode(report, childPrefix, idx === lastIdx);
    });
  }

  // Export the org chart to a JSON file
  exportToJSON(filename) {
    // Instead of directly stringifying this.root,
    // we can create a custom serialization that includes extra fields.
    const data = JSON.stringify(this.root, null, 2);
    fs.writeFileSync(filename, data);
    console.log(chalk.green(`Org chart exported to ${filename}`));
  }

  // Import an org chart from a JSON file
  importFromJSON(filename) {
    try {
      const data = fs.readFileSync(filename, 'utf8');
      const obj = JSON.parse(data);

      // Recreate the org chart from the JSON data
      this.employees = {};
      this._recreateFromJSON(obj);

      console.log(chalk.green(`Org chart imported from ${filename}`));
      return true;
    } catch (err) {
      console.error(chalk.red(`Error importing org chart: ${err.message}`));
      return false;
    }
  }

  // Helper method to recreate the org chart from JSON
  _recreateFromJSON(obj, manager = null) {
    // Note: We also restore lob, division, dept, email if present
    const employee = new Employee(
      obj.name,
      obj.title,
      obj.level,
      obj.lob || '',
      obj.division || '',
      obj.dept || '',
      obj.email || '',
      obj.id || null
    );
    this.employees[obj.name] = employee;

    if (!manager) {
      this.root = employee;
    } else {
      manager.addReport(employee);
    }

    if (obj.reports && obj.reports.length > 0) {
      obj.reports.forEach((report) => {
        this._recreateFromJSON(report, employee);
      });
    }

    return employee;
  }

  // Import employees from a CSV file
  importFromCSV(filename, mergeMode = false) {
    try {
      const csvData = fs.readFileSync(filename, 'utf8');
      
      // Parse CSV data
      const results = Papa.parse(csvData, {
        header: true,
        skipEmptyLines: true
      });
      
      if (results.errors.length > 0) {
        console.error(chalk.red(`Error parsing CSV: ${results.errors[0].message}`));
        return false;
      }
      
      if (results.data.length === 0) {
        console.error(chalk.red('CSV file is empty or has no valid data'));
        return false;
      }
      
      // Store current employees if in merge mode
      const existingEmployees = mergeMode ? {...this.employees} : {};
      const existingRoot = mergeMode ? this.root : null;
      
      // If not in merge mode, reset the org chart
      if (!mergeMode) {
        this.employees = {};
      }
      
      // Create a map to hold new employees before setting up relationships
      const newEmployeeMap = {};
      let newEmployeesCount = 0;
      let updatedEmployeesCount = 0;
      
      // First pass: create or update employees
      results.data.forEach(row => {
        // Skip rows that don't have the minimum required fields
        if (!row.name || !row.title) {
          console.warn(chalk.yellow(`Skipping row with missing name or title`));
          return;
        }
        
        // Check if this employee already exists in merge mode
        const existingEmployee = mergeMode ? this.employees[row.name] : null;
        
        if (existingEmployee && mergeMode) {
          // Update existing employee with data from CSV
          existingEmployee.title = row.title;
          existingEmployee.lob = row.lob || existingEmployee.lob;
          existingEmployee.division = row.division || existingEmployee.division;
          existingEmployee.dept = row.dept || existingEmployee.dept;
          existingEmployee.email = row.email || existingEmployee.email;
          // Don't update ID if it already exists
          
          newEmployeeMap[row.name] = existingEmployee;
          updatedEmployeesCount++;
        } else {
          // Create new employee
          const employee = new Employee(
            row.name,
            row.title,
            0, // Level will be set when building relationships
            row.lob || '',
            row.division || '',
            row.dept || '',
            row.email || '',
            row.id || null
          );
          
          newEmployeeMap[row.name] = employee;
          this.employees[row.name] = employee;
          newEmployeesCount++;
        }
      });
      
      // Second pass: establish manager-report relationships for new or updated employees
      results.data.forEach(row => {
        if (!row.name || !newEmployeeMap[row.name]) return;
        
        const employee = newEmployeeMap[row.name];
        
        // If manager is specified and exists in any map, establish relationship
        if (row.manager) {
          // Look for manager in new employees first, then in existing employees
          const manager = newEmployeeMap[row.manager] || (mergeMode ? this.employees[row.manager] : null);
          
          if (manager) {
            // Check if this employee is already a report of this manager
            const isAlreadyReport = manager.reports.some(report => report.name === employee.name);
            
            if (!isAlreadyReport) {
              // Remove from previous manager's reports if it exists somewhere else
              if (mergeMode) {
                Object.values(this.employees).forEach(potentialManager => {
                  if (potentialManager !== manager) {
                    potentialManager.reports = potentialManager.reports.filter(
                      report => report.name !== employee.name
                    );
                  }
                });
              }
              
              // Add to new manager
              manager.addReport(employee);
            }
          } else {
            console.warn(chalk.yellow(`Manager "${row.manager}" not found for employee "${row.name}". Employee will be added without a manager.`));
          }
        }
      });
      
      // Find the root if we're not in merge mode or if we don't have a root yet
      if (!mergeMode || !this.root) {
        const possibleRoots = Object.values(this.employees).filter(e => {
          // Check if this employee is not a report of any other employee
          return !Object.values(this.employees).some(manager => 
            manager.reports.includes(e)
          );
        });
        
        if (possibleRoots.length === 0) {
          console.error(chalk.red('No root employee found. CSV should have at least one employee with no manager.'));
          
          // Restore previous state if in merge mode
          if (mergeMode) {
            this.employees = existingEmployees;
            this.root = existingRoot;
          }
          
          return false;
        }
        
        if (possibleRoots.length > 1) {
          console.warn(chalk.yellow(`Found ${possibleRoots.length} employees with no manager. Using the first one as root.`));
        }
        
        this.root = possibleRoots[0];
      }
      
      // Output appropriate message based on mode
      if (mergeMode) {
        console.log(chalk.green(`Successfully merged CSV data: ${newEmployeesCount} new employees added, ${updatedEmployeesCount} existing employees updated`));
      } else {
        console.log(chalk.green(`Successfully imported ${Object.keys(this.employees).length} employees from CSV`));
      }
      
      return true;
    } catch (err) {
      console.error(chalk.red(`Error importing from CSV: ${err.message}`));
      return false;
    }
  }
}

// Main application class
class OrgChartApp {
  constructor() {
    this.orgChart = new OrgChart();
    this.currentFile = null;
  }
  
  // Helper method to add a back/cancel option to menu choices
  addBackOption(choices, backLabel = 'Back to main menu') {
    return [
      ...choices,
      new inquirer.Separator('-------------------'),
      { name: backLabel, value: 'back' }
    ];
  }
  
  // Generic helper method to search and select an employee
  async selectEmployee(message = 'Select an employee:', filter = null, entityType = 'employee') {
    let employees = Object.values(this.orgChart.employees);
    
    // Apply filter if provided
    if (filter) {
      employees = employees.filter(filter);
    }
    
    if (employees.length === 0) {
      console.log(chalk.yellow(`No ${entityType}s available.`));
      return 'back';
    }
    
    // Sort alphabetically
    employees.sort((a, b) => a.name.localeCompare(b.name));
    
    // Create array of labels for display
    const employeeLabels = employees.map(e => `${e.name} (${e.title})`);
    
    // Setup fuzzy search with Fuse.js
    const fuse = new Fuse(employeeLabels, { 
      threshold: 0.3,
      includeScore: true,
      keys: ['']  // Search the entire string
    });
    
    console.log(chalk.cyan(`Type to search for a ${entityType} by name or title`));
    
    // Get input for search
    const { searchTerm } = await inquirer.prompt([
      {
        type: 'input',
        name: 'searchTerm',
        message: `Search (leave empty to see all, or type "back" to go back):`,
      }
    ]);
    
    if (searchTerm.toLowerCase() === 'back') {
      return 'back';
    }
    
    let filteredEmployees;
    let employeeChoices;
    
    // Apply search filter if a term was entered
    if (searchTerm && searchTerm.trim() !== '') {
      const results = fuse.search(searchTerm);
      
      // Map back to our original objects, maintaining the search result order
      filteredEmployees = results.map(result => {
        const index = employeeLabels.indexOf(result.item);
        return employees[index];
      });
      
      // If no results, show all
      if (filteredEmployees.length === 0) {
        console.log(chalk.yellow(`No ${entityType}s found matching "${searchTerm}". Showing all ${entityType}s.`));
        filteredEmployees = employees;
      } else {
        console.log(chalk.green(`Found ${filteredEmployees.length} ${entityType}s matching "${searchTerm}"`));
      }
    } else {
      // No search term, show all
      filteredEmployees = employees;
    }
    
    // Create choices for the selection list
    employeeChoices = filteredEmployees.map(e => ({
      name: `${e.name} (${e.title})`,
      value: e.name
    }));
    
    // Add back option
    employeeChoices = this.addBackOption(employeeChoices);
    
    // Show the list for selection
    const { employeeName } = await inquirer.prompt([
      {
        type: 'list',
        name: 'employeeName',
        message,
        choices: employeeChoices,
        pageSize: 15
      }
    ]);
    
    return employeeName;
  }
  
  // Helper method specifically for manager selection
  async selectManager(message = 'Select a manager:') {
    return this.selectEmployee(message, null, 'manager');
  }

  // Display the main menu
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
          { name: 'Create a new org chart', value: 'new' },
          { name: 'Add an employee', value: 'add' },
          { name: 'Edit an employee', value: 'edit' },
          { name: 'Remove an employee', value: 'remove' },
          { name: 'Display org chart', value: 'display' },
          { name: 'Search employees', value: 'search' },
          new inquirer.Separator('--- File Operations ---'),
          { name: 'Save org chart', value: 'save' },
          { name: 'Load org chart', value: 'load' },
          { name: 'Import from CSV', value: 'importcsv' },
          new inquirer.Separator('--- Reports ---'),
          { name: 'Print reports', value: 'print' },
          new inquirer.Separator('-------------------'),
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
      case 'remove':
        await this.removeEmployee();
        break;
      case 'display':
        await this.displayOrgChart();
        break;
      case 'search':
        await this.searchEmployees();
        break;
      case 'save':
        await this.saveOrgChart();
        break;
      case 'load':
        await this.loadOrgChart();
        break;
      case 'importcsv':
        await this.importFromCSV();
        break;
      case 'print':
        await this.printMenu();
        break;
      case 'exit':
        return false;
    }

    // Prompt to continue
    if (action !== 'exit') {
      console.log(); // Add empty line for better spacing
      await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continue',
          message: chalk.cyan('Press Enter to return to main menu...'),
          default: true
        }
      ]);
      return true;
    }

    return false;
  }

  // Create a new org chart
  async createNewOrgChart() {
    console.clear();
    console.log(chalk.bold.yellow('Create a New Org Chart'));

    const { name } = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Enter the name of the CEO/root (or "back" to cancel):',
        validate: (input) => input.trim() !== '' || 'Name cannot be empty'
      }
    ]);
    
    if (name.toLowerCase() === 'back') {
      return;
    }
    
    const { title, lob, division, dept, email } = await inquirer.prompt([
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

    this.orgChart = new OrgChart();
    const ceo = new Employee(name, title, 0, lob, division, dept, email);
    this.orgChart.setRoot(ceo);
    this.currentFile = null;

    console.log(chalk.green(`Created a new org chart with ${name} as the root`));
  }

  // Add an employee to the org chart
  async addEmployee() {
    if (!this.orgChart.root) {
      console.log(chalk.red('Please create a new org chart first'));
      return;
    }

    console.clear();
    console.log(chalk.bold.yellow('Add an Employee'));

    // First ask for name, to allow early cancellation
    const { name } = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Enter the name of the employee (or "back" to cancel):',
        validate: (input) => input.trim() !== '' || 'Name cannot be empty'
      }
    ]);
    
    if (name.toLowerCase() === 'back') {
      return;
    }
    
    // Continue with title
    const { title } = await inquirer.prompt([
      {
        type: 'input',
        name: 'title',
        message: 'Enter their title:',
        validate: (input) => input.trim() !== '' || 'Title cannot be empty'
      }
    ]);
    
    // Select manager with search capability
    console.clear();
    console.log(chalk.bold.yellow('Add an Employee'));
    console.log(chalk.blue(`Name: ${name}`));
    console.log(chalk.blue(`Title: ${title}`));
    console.log();
    
    const managerName = await this.selectManager('Select their manager:');
    
    if (managerName === 'back') {
      return;
    }
    
    // Continue with remaining fields
    const { lob, division, dept, email } = await inquirer.prompt([
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

    this.orgChart.addEmployee(name, title, managerName, lob, division, dept, email);
    console.log(chalk.green(`Added ${name} reporting to ${managerName}`));
    
    // Ask if they want to add another employee
    const { addAnother } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'addAnother',
        message: 'Would you like to add another employee?',
        default: true
      }
    ]);
    
    if (addAnother) {
      await this.addEmployee();
    }
  }

  // NEW: Edit an existing employee
  async editEmployee() {
    if (!this.orgChart.root) {
      console.log(chalk.red('Please create a new org chart first'));
      return;
    }

    // Check if there are any employees
    if (Object.keys(this.orgChart.employees).length === 0) {
      console.log(chalk.yellow('No employees to edit.'));
      return;
    }
    
    // Use our helper method to select an employee to edit
    const employeeName = await this.selectEmployee('Select the employee to edit:');
    
    if (employeeName === 'back') {
      return;
    }

    const employee = this.orgChart.employees[employeeName];
    if (!employee) {
      console.log(chalk.red('Employee not found.'));
      return;
    }

    // Ask for new info; if empty, we'll leave the field unchanged
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

    try {
      this.orgChart.editEmployee(employeeName, answers);
      console.log(chalk.green(`Employee "${employeeName}" updated successfully.`));
      
      // Ask if they want to edit another employee
      const { editAnother } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'editAnother',
          message: 'Would you like to edit another employee?',
          default: true
        }
      ]);
      
      if (editAnother) {
        await this.editEmployee();
      }
    } catch (err) {
      console.log(chalk.red(`Error updating employee: ${err.message}`));
    }
  }

  // Remove an employee from the org chart
  async removeEmployee() {
    if (!this.orgChart.root) {
      console.log(chalk.red('Please create a new org chart first'));
      return;
    }

    console.clear();
    console.log(chalk.bold.yellow('Remove an Employee'));

    // Use our helper method to select an employee to remove, excluding the root
    const name = await this.selectEmployee(
      'Select the employee to remove:',
      (e) => e !== this.orgChart.root
    );
    
    if (name === 'back') {
      return;
    }
    
    const { reassignReports } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'reassignReports',
        message: 'Do you want to reassign their direct reports?',
        default: true
      }
    ]);

    let newManagerName = null;

    if (reassignReports) {
      console.clear();
      console.log(chalk.bold.yellow('Reassign Reports'));
      console.log(chalk.blue(`When removing: ${name}`));
      console.log();
      
      // Use our searchable manager selection method
      const manager = await this.selectManager('Select the new manager for their reports:');
      
      if (manager === 'back') {
        return;  // Cancel the removal if they back out of reassignment
      }
      
      newManagerName = manager;
    }

    this.orgChart.removeEmployee(name, newManagerName);
    console.log(chalk.green(`Removed ${name} from the org chart`));
    
    // Ask if they want to remove another employee
    const { removeAnother } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'removeAnother',
        message: 'Would you like to remove another employee?',
        default: false
      }
    ]);
    
    if (removeAnother) {
      await this.removeEmployee();
    }
  }

  // Display the org chart
  async displayOrgChart() {
    console.clear();
    console.log(chalk.bold.yellow('Organization Chart'));

    if (!this.orgChart.root) {
      console.log(chalk.red('Org chart is empty. Please create one first.'));
      return;
    }
    
    // Display the full organization chart
    this.orgChart.print();
    
    // Simple menu for org chart viewing actions
    while (true) {
      console.log();
      console.log(chalk.dim('─'.repeat(40)));
      
      const { viewOption } = await inquirer.prompt([
        {
          type: 'list',
          name: 'viewOption',
          message: 'Organization Chart Options:',
          choices: [
            { name: 'View full organization chart', value: 'full' },
            { name: 'Focus on a specific department', value: 'department' },
            { name: 'Return to main menu', value: 'exit' }
          ]
        }
      ]);
      
      if (viewOption === 'exit') {
        // Return to main menu without exiting the program
        return;
      }
      
      if (viewOption === 'full') {
        // Show the full organization chart again
        console.clear();
        console.log(chalk.bold.yellow('Complete Organization Chart'));
        this.orgChart.print();
        continue;
      }
      
      if (viewOption === 'department') {
        // Select a manager to focus on
        const managerName = await this.selectEmployee(
          'Select a department manager to focus on:',
          (e) => e.reports.length > 0,  // Filter to only show managers with reports
          'manager'
        );
        
        if (managerName === 'back') {
          // If user cancels, show the menu again
          console.clear();
          console.log(chalk.bold.yellow('Organization Chart'));
          this.orgChart.print();
          continue;
        }
        
        const manager = this.orgChart.employees[managerName];
        if (!manager) {
          console.log(chalk.red('Manager not found.'));
          await this.promptToContinue();
          console.clear();
          console.log(chalk.bold.yellow('Organization Chart'));
          this.orgChart.print();
          continue;
        }
        
        // Display the department view with a clear header
        console.clear();
        console.log(chalk.bold.yellow(`Department: ${manager.name}`));
        console.log(chalk.blue(`Title: ${manager.title}`));
        
        // Display additional details if available
        const details = [];
        if (manager.lob) details.push(`LOB: ${manager.lob}`);
        if (manager.division) details.push(`Division: ${manager.division}`);
        if (manager.dept) details.push(`Department: ${manager.dept}`);
        
        if (details.length > 0) {
          console.log(details.join(' | '));
        }
        
        console.log(chalk.dim('─'.repeat(40)));
        
        // Create a temporary org chart with just this manager's subtree
        const tempOrgChart = new OrgChart();
        tempOrgChart.setRoot(manager);
        tempOrgChart.print();
        
        // Add a small sub-menu for department view
        console.log();
        const { deptOption } = await inquirer.prompt([
          {
            type: 'list',
            name: 'deptOption',
            message: 'Department View Options:',
            choices: [
              { name: 'Return to full organization chart', value: 'full' },
              { name: 'Choose another department', value: 'another' },
              { name: 'Return to main menu', value: 'exit' }
            ]
          }
        ]);
        
        if (deptOption === 'exit') {
          return; // Return to main menu
        } else if (deptOption === 'full') {
          console.clear();
          console.log(chalk.bold.yellow('Complete Organization Chart'));
          this.orgChart.print();
          continue;
        }
        // If 'another', just let the loop continue to show the options again
      }
    }
  }
  
  // Helper method for "press Enter to continue" prompts
  async promptToContinue() {
    console.log();
    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: 'Press Enter to continue...',
        default: ''
      }
    ]);
  }

  // Search for employees
  async searchEmployees() {
    if (!this.orgChart.root) {
      console.log(chalk.red('Org chart is empty. Please create one first.'));
      return;
    }

    console.clear();
    console.log(chalk.bold.yellow('Search Employees'));

    const { query } = await inquirer.prompt([
      {
        type: 'input',
        name: 'query',
        message: 'Enter search term (ID, name, title, LOB, etc.):',
        validate: (input) => input.trim() !== '' || 'Search term cannot be empty'
      }
    ]);

    const results = this.orgChart.search(query);

    if (results.length === 0) {
      console.log(chalk.yellow(`No employees found matching "${query}"`));
      return;
    }

    console.log(
      chalk.green(`Found ${results.length} employee(s) matching "${query}":`)
    );

    results.forEach((employee, index) => {
      console.log(
        chalk.bold(`\n${index + 1}. ${chalk.green(employee.name)} - ${chalk.blue(employee.title)}`)
      );

      // Show other info
      console.log(`   ID: ${chalk.yellow(employee.id)}`);
      console.log(`   LOB: ${chalk.cyan(employee.lob || 'N/A')}`);
      console.log(`   Division: ${chalk.cyan(employee.division || 'N/A')}`);
      console.log(`   Department: ${chalk.cyan(employee.dept || 'N/A')}`);
      console.log(`   Email: ${chalk.cyan(employee.email || 'N/A')}`);

      // Show who they report to
      const manager = this.orgChart._findManager(employee.name);
      if (manager) {
        console.log(
          `   Reports to: ${chalk.cyan(manager.name)} (${manager.title})`
        );
      } else {
        console.log(`   Reports to: ${chalk.gray('None (Top of organization)')}`);
      }

      // Show their direct reports
      if (employee.reports.length > 0) {
        console.log(`   Direct reports: ${employee.reports.length}`);
        employee.reports.forEach((report) => {
          console.log(`     - ${chalk.cyan(report.name)} (${report.title})`);
        });
      } else {
        console.log(`   Direct reports: ${chalk.gray('None')}`);
      }
    });

    // Allow viewing detailed info for one of the results
    if (results.length > 0) {
      const { viewDetails } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'viewDetails',
          message:
            'Would you like to view detailed information for one of these employees?',
          default: false
        }
      ]);

      if (viewDetails) {
        const employeeChoices = results.map((e, i) => ({
          name: `${e.name} (${e.title})`,
          value: i
        }));
        
        const { employeeIndex } = await inquirer.prompt([
          {
            type: 'list',
            name: 'employeeIndex',
            message: 'Select an employee:',
            choices: this.addBackOption(employeeChoices, 'Back to search results')
          }
        ]);
        
        if (employeeIndex === 'back') {
          return;
        }

        await this.displayEmployeeDetails(results[employeeIndex].name);
      }
    }
  }

  // Display detailed information about an employee
  async displayEmployeeDetails(employeeName) {
    const employee = this.orgChart.employees[employeeName];
    if (!employee) return;

    console.clear();
    console.log(chalk.bold.yellow(`Employee Details: ${employee.name}`));

    // Basic information
    console.log(chalk.bold('\nBasic Information:'));
    console.log(`ID: ${chalk.yellow(employee.id)}`);
    console.log(`Name: ${chalk.green(employee.name)}`);
    console.log(`Title: ${chalk.blue(employee.title)}`);
    console.log(`LOB: ${chalk.cyan(employee.lob || 'N/A')}`);
    console.log(`Division: ${chalk.cyan(employee.division || 'N/A')}`);
    console.log(`Department: ${chalk.cyan(employee.dept || 'N/A')}`);
    console.log(`Email: ${chalk.cyan(employee.email || 'N/A')}`);
    console.log(
      `Level: ${chalk.cyan(employee.level)} ${
        employee.level === 0 ? '(Top level)' : ''
      }`
    );

    // Organization path
    console.log(chalk.bold('\nOrganizational Hierarchy:'));
    const path = this.orgChart.getPath(employee.name);

    if (path.length > 0) {
      path.forEach((pathEmployee, index) => {
        const indent = '  '.repeat(index);
        console.log(
          `${indent}${
            index === path.length - 1 ? '└─ ' : '├─ '
          }${chalk.green(pathEmployee.name)} (${pathEmployee.title})`
        );
      });
    }

    // Direct reports
    console.log(chalk.bold('\nDirect Reports:'));
    if (employee.reports.length > 0) {
      employee.reports.forEach((report) => {
        console.log(`- ${chalk.green(report.name)} (${report.title})`);

        // Second level (reports of reports)
        if (report.reports.length > 0) {
          report.reports.forEach((subReport) => {
            console.log(`  └─ ${chalk.cyan(subReport.name)} (${subReport.title})`);
          });
        }
      });
    } else {
      console.log(chalk.gray('No direct reports'));
    }

    // Print options
    const actionChoices = [
      { name: 'Print employee details', value: 'print' },
      { name: 'Print organizational subtree', value: 'subtree' }
    ];
    
    const { printAction } = await inquirer.prompt([
      {
        type: 'list',
        name: 'printAction',
        message: 'What would you like to do?',
        choices: this.addBackOption(actionChoices, 'Back')
      }
    ]);

    switch (printAction) {
      case 'print':
        this.printEmployeeDetails(employee);
        break;
      case 'subtree':
        this.printSubtree(employee);
        break;
      case 'back':
      default:
        return;
    }
  }

  // Print employee details to a file
  async printEmployeeDetails(employee) {
    const { filename } = await inquirer.prompt([
      {
        type: 'input',
        name: 'filename',
        message: 'Enter filename to save the details (or "back" to cancel):',
        default: `${employee.name.toLowerCase().replace(/\s+/g, '_')}_details.txt`,
        validate: (input) => input.trim() !== '' || 'Filename cannot be empty'
      }
    ]);
    
    if (filename.toLowerCase() === 'back') {
      return;
    }

    let content = '';

    // Basic information
    content += `EMPLOYEE DETAILS: ${employee.name.toUpperCase()}\n`;
    content += `====================${'='.repeat(employee.name.length)}\n\n`;
    content += `ID: ${employee.id}\n`;
    content += `Name: ${employee.name}\n`;
    content += `Title: ${employee.title}\n`;
    content += `LOB: ${employee.lob}\n`;
    content += `Division: ${employee.division}\n`;
    content += `Department: ${employee.dept}\n`;
    content += `Email: ${employee.email}\n`;
    content += `Level: ${employee.level}\n\n`;

    // Organization path
    content += `ORGANIZATIONAL HIERARCHY:\n`;
    content += `------------------------\n`;
    const path = this.orgChart.getPath(employee.name);

    if (path.length > 0) {
      path.forEach((pathEmployee, index) => {
        const indent = '  '.repeat(index);
        content += `${indent}${
          index === path.length - 1 ? '└─ ' : '├─ '
        }${pathEmployee.name} (${pathEmployee.title})\n`;
      });
    }

    content += '\n';

    // Direct reports
    content += `DIRECT REPORTS:\n`;
    content += `--------------\n`;
    if (employee.reports.length > 0) {
      employee.reports.forEach((report) => {
        content += `- ${report.name} (${report.title})\n`;

        // Second level (reports of reports)
        if (report.reports.length > 0) {
          report.reports.forEach((subReport) => {
            content += `  └─ ${subReport.name} (${subReport.title})\n`;
          });
        }
      });
    } else {
      content += 'No direct reports\n';
    }

    content += '\n';
    content += `Generated on: ${new Date().toLocaleString()}\n`;

    fs.writeFileSync(filename, content);
    console.log(chalk.green(`Employee details saved to ${filename}`));
    
    // Return to employee display
    return;
  }

  // Print a subtree of the organization
  async printSubtree(rootEmployee) {
    const { filename } = await inquirer.prompt([
      {
        type: 'input',
        name: 'filename',
        message: 'Enter filename to save the subtree (or "back" to cancel):',
        default: `${rootEmployee.name.toLowerCase().replace(/\s+/g, '_')}_subtree.txt`,
        validate: (input) => input.trim() !== '' || 'Filename cannot be empty'
      }
    ]);
    
    if (filename.toLowerCase() === 'back') {
      return;
    }

    let content = '';

    // Header
    content += `ORGANIZATIONAL SUBTREE: ${rootEmployee.name.toUpperCase()}\n`;
    content += `======================${'='.repeat(rootEmployee.name.length)}\n\n`;

    // Capture console.log output
    const oldLog = console.log;
    const logs = [];
    console.log = (...args) => logs.push(args.join(' '));

    // Print the subtree using the existing print method
    this._printSubtree(rootEmployee);

    // Restore console.log
    console.log = oldLog;

    // Add the captured output to the content
    content += logs.join('\n');

    content += '\n\n';
    content += `Generated on: ${new Date().toLocaleString()}\n`;

    fs.writeFileSync(filename, content);
    console.log(chalk.green(`Organizational subtree saved to ${filename}`));
    
    // Return to previous screen
    return;
  }

  // Helper method to print a subtree
  _printSubtree(node) {
    this._printNode(node, '', true);
  }

  // Helper method to print a node
  _printNode(node, prefix, isTail) {
    // Print current node
    const connector = isTail ? '└── ' : '├── ';
    
    // Standard text mode
    console.log(`${prefix}${connector}${node.name} (${node.title})`);

    // Prepare prefix for children
    const childPrefix = prefix + (isTail ? '    ' : '│   ');

    // Print children
    const lastIdx = node.reports.length - 1;
    node.reports.forEach((report, idx) => {
      this._printNode(report, childPrefix, idx === lastIdx);
    });
  }

  // Save the org chart to a file
  async saveOrgChart() {
    if (!this.orgChart.root) {
      console.log(chalk.red('Nothing to save. Please create an org chart first.'));
      return;
    }

    console.clear();
    console.log(chalk.bold.yellow('Save Org Chart'));

    const { filename } = await inquirer.prompt([
      {
        type: 'input',
        name: 'filename',
        message: 'Enter the filename to save (or "back" to cancel):',
        default: this.currentFile || 'orgchart.json',
        validate: (input) => input.trim() !== '' || 'Filename cannot be empty'
      }
    ]);
    
    if (filename.toLowerCase() === 'back') {
      return;
    }

    this.orgChart.exportToJSON(filename);
    this.currentFile = filename;
  }

  // Load an org chart from a file
  async loadOrgChart() {
    console.clear();
    console.log(chalk.bold.yellow('Load Org Chart'));

    // Try to list JSON files in the current directory
    let files = [];
    try {
      const dirFiles = fs.readdirSync('./');
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
        choices: this.addBackOption(choices)
      }
    ]);
    
    if (fileChoice === 'back') {
      return;
    }

    let filename = fileChoice;

    if (fileChoice === 'custom') {
      const { customFile } = await inquirer.prompt([
        {
          type: 'input',
          name: 'customFile',
          message: 'Enter the filename to load (or "back" to cancel):',
          validate: (input) => input.trim() !== '' || 'Filename cannot be empty'
        }
      ]);
      
      if (customFile.toLowerCase() === 'back') {
        return;
      }

      filename = customFile;
    }

    const success = this.orgChart.importFromJSON(filename);
    if (success) {
      this.currentFile = filename;
    }
  }
  
  // Import org chart from a CSV file
  async importFromCSV() {
    console.clear();
    console.log(chalk.bold.yellow('Import from CSV'));
    console.log(chalk.cyan('CSV format should include columns: name, title, manager, lob, division, dept, email, id'));
    console.log(chalk.cyan('The "manager" column should contain the name of the employee\'s manager'));
    console.log(chalk.cyan('At least one employee should have no manager (they will be the root)'));
    
    // Try to list CSV files in the current directory
    let files = [];
    try {
      const dirFiles = fs.readdirSync('./');
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
        choices: this.addBackOption(choices)
      }
    ]);
    
    if (fileChoice === 'back') {
      return;
    }
    
    let filename = fileChoice;
    
    if (fileChoice === 'custom') {
      const { customFile } = await inquirer.prompt([
        {
          type: 'input',
          name: 'customFile',
          message: 'Enter the filename to import (or "back" to cancel):',
          validate: (input) => input.trim() !== '' || 'Filename cannot be empty'
        }
      ]);
      
      if (customFile.toLowerCase() === 'back') {
        return;
      }
      
      filename = customFile;
    }
    
    // Determine if there's an existing org chart and offer merge option
    let mergeMode = false;
    
    if (this.orgChart.root && Object.keys(this.orgChart.employees).length > 0) {
      const { importMode } = await inquirer.prompt([
        {
          type: 'list',
          name: 'importMode',
          message: 'How would you like to import this file?',
          choices: [
            { name: 'Replace current org chart', value: 'replace' },
            { name: 'Merge with current org chart (add/update employees)', value: 'merge' }
          ]
        }
      ]);
      
      mergeMode = importMode === 'merge';
      
      if (mergeMode) {
        console.log(chalk.cyan('Merge mode: Employees with the same name will be updated, new employees will be added.'));
      } else {
        console.log(chalk.yellow('Replace mode: Current org chart will be completely replaced.'));
      }
    }
    
    const success = this.orgChart.importFromCSV(filename, mergeMode);
    
    if (success) {
      // Don't set currentFile since this isn't a JSON file
      if (mergeMode) {
        console.log(chalk.green('CSV data successfully merged with current org chart'));
      } else {
        console.log(chalk.green('Org chart imported successfully from CSV'));
      }
      
      // Give the option to save as JSON
      const { saveAsJson } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'saveAsJson',
          message: 'Would you like to save this org chart as JSON?',
          default: true
        }
      ]);
      
      if (saveAsJson) {
        await this.saveOrgChart();
      }
    }
  }

  // Print menu for various report options
  async printMenu() {
    if (!this.orgChart.root) {
      console.log(chalk.red('Org chart is empty. Please create one first.'));
      return;
    }

    console.clear();
    console.log(chalk.bold.yellow('Print Reports'));

    const choices = [
      { name: 'Complete Organization Chart', value: 'full' },
      { name: 'Department/Manager Subtree', value: 'subtree' },
      { name: 'Employee Directory', value: 'directory' },
      { name: 'Statistics Report', value: 'stats' }
    ];

    const { reportType } = await inquirer.prompt([
      {
        type: 'list',
        name: 'reportType',
        message: 'What type of report would you like to print?',
        choices: this.addBackOption(choices)
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
      case 'back':
      default:
        return;
    }
  }

  // Print the full organization chart to a file
  async printFullOrgChart() {
    const { filename } = await inquirer.prompt([
      {
        type: 'input',
        name: 'filename',
        message: 'Enter filename to save the organization chart (or "back" to cancel):',
        default: 'full_org_chart.txt',
        validate: (input) => input.trim() !== '' || 'Filename cannot be empty'
      }
    ]);
    
    if (filename.toLowerCase() === 'back') {
      return;
    }

    let content = '';

    // Header
    content += `ORGANIZATION CHART\n`;
    content += `=================\n\n`;

    // Capture console.log output
    const oldLog = console.log;
    const logs = [];
    console.log = (...args) => logs.push(args.join(' '));

    // Print the org chart using the existing print method
    this.orgChart.print();

    // Restore console.log
    console.log = oldLog;

    // Add the captured output to the content
    content += logs.join('\n');

    content += '\n\n';
    content += `Total Employees: ${Object.keys(this.orgChart.employees).length}\n`;
    content += `Generated on: ${new Date().toLocaleString()}\n`;

    fs.writeFileSync(filename, content);
    console.log(chalk.green(`Organization chart saved to ${filename}`));
    
    // Ask if they want to generate another report
    const { printAnother } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'printAnother',
        message: 'Would you like to generate another report?',
        default: true
      }
    ]);
    
    if (printAnother) {
      await this.printMenu();
    }
  }

  // Print a subtree report
  async printSubtreeReport() {
    // Use our helper method to select a manager with reports
    const managerName = await this.selectEmployee(
      'Select a manager to print their department:',
      (e) => e.reports.length > 0,
      'manager'
    );
    
    if (managerName === 'back') {
      return;
    }

    const manager = this.orgChart.employees[managerName];
    if (!manager) return;

    await this.printSubtree(manager);
  }

  // Print an employee directory
  async printEmployeeDirectory() {
    const { filename } = await inquirer.prompt([
      {
        type: 'input',
        name: 'filename',
        message: 'Enter filename to save the employee directory (or "back" to cancel):',
        default: 'employee_directory.txt',
        validate: (input) => input.trim() !== '' || 'Filename cannot be empty'
      }
    ]);
    
    if (filename.toLowerCase() === 'back') {
      return;
    }

    let content = '';

    // Header
    content += `EMPLOYEE DIRECTORY\n`;
    content += `=================\n\n`;

    // Sort employees by name
    const sortedEmployees = Object.values(this.orgChart.employees).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    // Add each employee
    sortedEmployees.forEach((employee, index) => {
      content += `${index + 1}. ${employee.name}\n`;
      content += `   ID: ${employee.id}\n`;
      content += `   Title: ${employee.title}\n`;
      content += `   LOB: ${employee.lob}\n`;
      content += `   Division: ${employee.division}\n`;
      content += `   Department: ${employee.dept}\n`;
      content += `   Email: ${employee.email}\n`;

      // Manager
      const manager = this.orgChart._findManager(employee.name);
      if (manager) {
        content += `   Reports to: ${manager.name} (${manager.title})\n`;
      } else {
        content += `   Reports to: None (Top of organization)\n`;
      }

      // Add direct reports count
      if (employee.reports.length > 0) {
        content += `   Direct reports: ${employee.reports.length}\n`;
      } else {
        content += `   Direct reports: None\n`;
      }

      content += '\n';
    });

    content += `Total Employees: ${sortedEmployees.length}\n`;
    content += `Generated on: ${new Date().toLocaleString()}\n`;

    fs.writeFileSync(filename, content);
    console.log(chalk.green(`Employee directory saved to ${filename}`));
    
    // Ask if they want to generate another report
    const { printAnother } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'printAnother',
        message: 'Would you like to generate another report?',
        default: true
      }
    ]);
    
    if (printAnother) {
      await this.printMenu();
    }
  }

  // Print a statistics report
  async printStatisticsReport() {
    const { filename } = await inquirer.prompt([
      {
        type: 'input',
        name: 'filename',
        message: 'Enter filename to save the statistics report (or "back" to cancel):',
        default: 'org_statistics.txt',
        validate: (input) => input.trim() !== '' || 'Filename cannot be empty'
      }
    ]);
    
    if (filename.toLowerCase() === 'back') {
      return;
    }

    const employees = Object.values(this.orgChart.employees);

    // Calculate statistics
    const totalEmployees = employees.length;
    const maxLevel = Math.max(...employees.map((e) => e.level));

    // Count employees by level
    const employeesByLevel = Array(maxLevel + 1).fill(0);
    employees.forEach((e) => {
      employeesByLevel[e.level]++;
    });

    // Average span of control
    const managersCount = employees.filter((e) => e.reports.length > 0).length;
    const avgSpan =
      managersCount > 0
        ? (totalEmployees - 1) / managersCount // Subtract 1 for the root employee
        : 0;

    // Find manager with most direct reports
    let maxReports = 0;
    let managerWithMostReports = null;
    employees.forEach((e) => {
      if (e.reports.length > maxReports) {
        maxReports = e.reports.length;
        managerWithMostReports = e;
      }
    });

    let content = '';

    // Header
    content += `ORGANIZATION STATISTICS REPORT\n`;
    content += `============================\n\n`;

    // General statistics
    content += `General Statistics:\n`;
    content += `-----------------\n`;
    content += `Total Employees: ${totalEmployees}\n`;
    content += `Organization Depth: ${maxLevel + 1} levels\n`;
    content += `Total Managers: ${managersCount}\n`;
    content += `Average Span of Control: ${avgSpan.toFixed(2)} direct reports per manager\n\n`;

    // Employees by level
    content += `Employees by Level:\n`;
    content += `-----------------\n`;
    employeesByLevel.forEach((count, level) => {
      content += `Level ${level}: ${count} employees ${
        level === 0 ? '(Top level)' : ''
      }\n`;
    });
    content += '\n';

    // Manager with most direct reports
    if (managerWithMostReports) {
      content += `Manager with Most Direct Reports:\n`;
      content += `-------------------------------\n`;
      content += `${managerWithMostReports.name} (${managerWithMostReports.title}): ${maxReports} direct reports\n\n`;
    }

    // Employees with no direct reports
    const individualContributors = employees.filter((e) => e.reports.length === 0);
    content += `Individual Contributors: ${individualContributors.length} (${(
      (individualContributors.length / totalEmployees) *
      100
    ).toFixed(1)}% of organization)\n\n`;

    content += `Generated on: ${new Date().toLocaleString()}\n`;

    fs.writeFileSync(filename, content);
    console.log(chalk.green(`Statistics report saved to ${filename}`));
    
    // Ask if they want to generate another report
    const { printAnother } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'printAnother',
        message: 'Would you like to generate another report?',
        default: true
      }
    ]);
    
    if (printAnother) {
      await this.printMenu();
    }
  }

  // Run the application
  async run() {
    console.log(chalk.bold.green('Welcome to Terminal Org Chart!'));
    console.log(chalk.gray('Press Ctrl+C at any time to exit'));
    console.log();

    try {
      let running = true;
      while (running) {
        running = await this.mainMenu();
      }
    } catch (err) {
      // Handle keyboard interrupts (Ctrl+C) gracefully
      if (err.isTtyError) {
        console.log('\n'); // Add newline for cleaner display
      } else {
        console.error(chalk.red(`\nAn error occurred: ${err.message}`));
      }
    }

    console.log(chalk.bold.green('Thank you for using Terminal Org Chart!'));
  }
}

// Run the application
const app = new OrgChartApp();
app.run();
