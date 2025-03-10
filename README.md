# Terminal Org Chart App

A feature-rich command-line application for creating, managing, and visualizing organizational hierarchies.

## Features

### Employee Management
- Create organizational charts with hierarchical reporting structures
- Add, edit, and remove employees with comprehensive details
- Auto-generated UUIDs for each employee
- Track employee metadata (name, title, department, division, email, etc.)
- Seamless handling of reporting relationships

### Search and Navigation
- Advanced fuzzy search for finding employees quickly
- Search across all employee fields (name, title, LOB, division, etc.)
- Intuitive keyboard navigation through menus
- Back/cancel options at every step
- Streamlined multi-employee operations

### Data Import/Export
- Import from CSV with automatic structure detection
- Import/export to JSON for data persistence
- Automatic relationship rebuilding during imports

### Reporting
- Generate full organization charts
- Create departmental/manager subtree reports
- Export employee directories
- Generate organization statistics reports
- Print individual employee details

### User Experience
- Color-coded terminal interface for better readability
- Clear menu structure with organized options
- Confirmation dialogs for destructive actions
- Intuitive keyboard shortcuts
- Consistent navigation patterns

## Dependencies

```json
{
  "dependencies": {
    "chalk": "^4.1.2",      // Terminal text styling and colors
    "fuse.js": "^7.1.0",    // Fuzzy search functionality
    "inquirer": "^8.2.6",   // Interactive command line interface
    "papaparse": "^5.5.2",  // CSV parsing capabilities
    "uuid": "^11.1.0"       // UUID generation for employees
  }
}
```

## Installation

1. Clone this repository
2. Install dependencies:
   ```
   npm install chalk@^4.1.2 fuse.js@^7.1.0 inquirer@^8.2.6 papaparse@^5.5.2 uuid@^11.1.0
   ```
3. Run the application:
   ```
   node orgchart.js
   ```

## Usage

Launch the application and follow the interactive prompts to:

1. Create a new organization chart
2. Add employees to the hierarchy
3. Visualize the organizational structure
4. Generate various reports
5. Import/export data

## File Formats

### CSV Import Format
For importing from CSV, your file should include these columns:
- name (required)
- title (required)
- manager (optional, contains the name of the employee's manager)
- lob (optional)
- division (optional)
- dept (optional)
- email (optional)
- id (optional, a UUID will be generated if not provided)

### JSON Structure
The application uses a hierarchical JSON structure where each employee object contains:
- Personal details (name, title, id, etc.)
- A "reports" array containing employee objects that report to them

## License
MIT
