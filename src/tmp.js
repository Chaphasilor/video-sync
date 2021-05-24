const inquirer = require(`inquirer`)
inquirer.registerPrompt('fs-selector', require('inquirer-fs-selector'));

// inquirer.prompt([{
//   type: 'fs-selector',
//   name: 'fs',
//   message: 'Choose a file or directory',
//   basePath: './',
//   options: {
//     displayHidden: false,
//     displayFiles: true,
//     canSelectFile: true,
//     icons: false, // not show icons
//   }
// }]).then((answers) => {
//   console.log(answers.fs)
// })