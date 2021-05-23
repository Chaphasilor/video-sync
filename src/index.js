const fs = require(`fs`)

const betterLogging = require(`better-logging`)
betterLogging(console, {
  format: process.env.environment !== `production` ? undefined : ctx => `${ctx.STAMP(new Date().toISOString().slice(0, 19).replace(`T`, `_`))} ${ctx.type} ${ctx.msg}`,
  messageConstructionStrategy: betterLogging.MessageConstructionStrategy.FIRST,
})

const {Command, flags} = require(`@oclif/command`)
const inquirer = require(`inquirer`)
const cli = require(`cli-ux`).default
const ms = require(`ms`)

const { ALGORITHMS, calcOffset } = require(`../util/calc-offset`)
const merge = require(`../util/merge-tracks`)
const tracks = require(`../util/tracks`)

class VideoSyncCommand extends Command {
  async run() {
    
    const { args, flags } = this.parse(VideoSyncCommand)

    console.logLevel = flags.verbose ? 4 : 2
    
    let algorithm
    switch (flags.algorithm) {
      case `ssim`:
        algorithm = ALGORITHMS.SSIM
        break;
      case `matching-pixels`:
        algorithm = ALGORITHMS.MISMATCHED_PIXELS
        break;
      default:
        algorithm = ALGORITHMS.SSIM
        break;
    }
    
    let answers = await inquirer.prompt([
      {
        type: `input`,
        message: `Enter the destination file (where you want the synced tracks to be added to)`,
        name: `destination`,
        validate: function (answer) {
          if (!fs.existsSync(answer)) {
            return `The path you provided doesn't exist. Please provide a valid path to a video file.`;
          }
          return true;
        },
      },
      {
        type: `input`,
        message: `Enter the offset (in ms or with units) for the destination file (where to start looking for matching frames while synching)`,
        name: `destinationOffset`,
        validate: (formattedInput) => {
          if (formattedInput === undefined) {
            return `Didn't recognize that time string! Valid units: ms, s, m, h.`
          } else if (formattedInput < 0) {
            return `Only positive offsets are supported. '0' is the beginning of the video.`
          } else {
            return true
          }
        },
        filter: (input) => {
          let matches = input.match(/(\-\s*)\d/g)?.map(x => x.slice(0, -1)) || []
          input = matches.reduce((sum, cur) => sum.replace(cur, `-`), input)
          return input.split(` `).reduce((sum, cur) => sum + ms(cur), 0)
        },
      },
      {
        type: `input`,
        message: `Enter the source file (that contains the new tracks to be synced over)`,
        name: `source`,
        validate: function (answer) {
          if (!fs.existsSync(answer)) {
            return `The path you provided doesn't exist. Please provide a valid path to a video file.`;
          }
          return true;
        },
      },
      {
        type: `input`,
        message: `Enter the offset (in ms or with units) for the source file (where to start looking for matching frames while syncing)`,
        name: `sourceOffset`,
        validate: (formattedInput) => {
          if (formattedInput === undefined || isNaN(formattedInput)) {
            return `Didn't recognize that time string! Valid units: ms, s, m, h.`
          } else if (formattedInput < 0) {
            return `Only positive offsets are supported. '0' is the beginning of the video.`
          } else {
            return true
          }
        },
        filter: (input) => {
          let matches = input.match(/(\-\s*)\d/g)?.map(x => x.slice(0, -1)) || []
          input = matches.reduce((sum, cur) => sum.replace(cur, `-`), input)
          return input.split(` `).reduce((sum, cur) => sum + ms(cur), 0)
        },
      },
      {
        type: `input`,
        message: `Specify the output file (where the synced and muxed video gets written to)`,
        name: `output`,
      },
    ])
  
    let availableTracks = tracks.getTrackInfo(answers.source)
    
    let selectedTracks = await inquirer.prompt([
      {
        type: `checkbox`,
        message: `Which audio tracks do you want copied and synced?`,
        name: `audio`,
        when: availableTracks.audio.length > 0,
        choices: availableTracks.audio.map(info => {
          return {
            name: `${info.name ? `"${info.name}"` : `*nameless*`} (${info.language}, ${info.codec}, ${info.channels} channel${info.channels.length > 1 ? `s`: ``}) - ID ${info.ids.mkvmerge}`,
            value: info.ids.mkvmerge,
            checked: false,
            disabled: false,
          }
        }),
        validate: function (answer) {
          if (answer.length < 1) {
            return `You must choose at least one track. Use <space> to toggle selection, <enter> to confirm.`;
          }
  
          return true;
        },
      },
      {
        type: `checkbox`,
        message: `Which subtitle tracks do you want copied and synced?`,
        name: `subs`,
        when: availableTracks.subs.length > 0,
        choices: availableTracks.subs.map(info => {
          return {
            name: `${info.name ? `"${info.name}"` : `*nameless*`} (${info.language}, ${info.codec}) - ID ${info.ids.mkvmerge}`,
            value: info.ids.mkvmerge,
            checked: false,
            disabled: false,
          }
        }),
      },
    ])

    // inquirer doesn't include a property if it wasn't included due to `when`
    selectedTracks = {
      audio: selectedTracks.audio ?? [],
      subs: selectedTracks.subs ?? [],
    }
      
    const { videoOffset, confidence } = await calcOffset(answers.destination, answers.source, answers.destinationOffset, answers.sourceOffset, {
      algorithm,
      iterations: flags.iterations,
      searchWidth: flags.searchWidth,
      searchResolution: flags.searchResolution,
    })

    let continueWithMerging = true

    if (flags.algorithm === `ssim` && confidence < 0.5) {
      continueWithMerging = (await inquirer.prompt([{
        type: `confirm`,
        name: `continue`,
        message: `Syncing confidence is very low (${confidence}). Do you want to continue?`,
      }])).continue
    }

    if (continueWithMerging) {
      try {
        await merge(answers.destination, answers.source, answers.output, videoOffset, selectedTracks)
      } catch (err) {
        console.error(err.message)
      }
    }
    
  }
}

VideoSyncCommand.description = `Describe the command here
...
Extra documentation goes here
`

VideoSyncCommand.args = [
  {
    name: `video1`,               // name of arg to show in help and reference with args[name]
    required: false,            // make the arg required with `required: true`
    description: `video to be synced *with*`, // help description
  },
  {
    name: `offset1`,               // name of arg to show in help and reference with args[name]
    required: false,            // make the arg required with `required: true`
    description: `frame offset for the first video`, // help description
  },
  {
    name: `video2`,               // name of arg to show in help and reference with args[name]
    required: false,            // make the arg required with `required: true`
    description: `video to be synced`, // help description
  },
  {
    name: `offset2`,               // name of arg to show in help and reference with args[name]
    required: false,            // make the arg required with `required: true`
    description: `frame offset for the second video`, // help description
  },
]

VideoSyncCommand.flags = {
  version: flags.version(), // add --version flag to show CLI version
  help: flags.help({char: `h`}), // add --help flag to show CLI version
  algorithm: flags.enum({
    char: `a`,
    description: `matching algorithm to use`,
    options: [`ssim`, `matching-pixels`],
    default: `ssim`,
  }),
  iterations: flags.integer({
    char: `i`,
    description: `number of iterations to perform`,
    default: 2,
  }),
  searchWidth: flags.integer({
    char: `w`,
    description: `width of the search region (in seconds). the program will find the closest matching frame in this region, OFFSET2 being the center`,
    default: 10,
  }),
  searchResolution: flags.integer({
    char: `r`,
    description: `resolution of the search region (in frames). increases accuracy at the cost of longer runtime`,
    default: 40,
  }),
  verbose: flags.boolean({
    char: `v`,
    description: `output additional logs`,
    default: false,
  }),
}

module.exports = VideoSyncCommand
