const betterLogging = require(`better-logging`)
betterLogging(console, {
  format: process.env.environment !== `production` ? undefined : ctx => `${ctx.STAMP(new Date().toISOString().slice(0, 19).replace(`T`, `_`))} ${ctx.type} ${ctx.msg}`,
  messageConstructionStrategy: betterLogging.MessageConstructionStrategy.FIRST,
})

const {Command, flags} = require('@oclif/command')
const cli = require(`cli-ux`).default

const { ALGORITHMS, calcOffset } = require(`../util/calc-offset`)
const merge = require(`../util/merge-tracks`)

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
    
    // cli.action.start(`Checking offset`)
    
    calcOffset(args.video1, args.video2, args.offset1, args.offset2, {
      algorithm,
      iterations: flags.iterations,
      searchWidth: flags.searchWidth,
      searchResolution: flags.searchResolution,
    }).then((offset) => {
      // cli.action.stop()
      merge(offset)
    })
    
  }
}

VideoSyncCommand.description = `Describe the command here
...
Extra documentation goes here
`

VideoSyncCommand.args = [
  {
    name: 'video1',               // name of arg to show in help and reference with args[name]
    required: true,            // make the arg required with `required: true`
    description: 'video to be synced *with*', // help description
  },
  {
    name: 'offset1',               // name of arg to show in help and reference with args[name]
    required: true,            // make the arg required with `required: true`
    description: 'frame offset for the first video', // help description
  },
  {
    name: 'video2',               // name of arg to show in help and reference with args[name]
    required: true,            // make the arg required with `required: true`
    description: 'video to be synced', // help description
  },
  {
    name: 'offset2',               // name of arg to show in help and reference with args[name]
    required: true,            // make the arg required with `required: true`
    description: 'frame offset for the second video', // help description
  },
]

VideoSyncCommand.flags = {
  version: flags.version(), // add --version flag to show CLI version
  help: flags.help({char: 'h'}), // add --help flag to show CLI version
  algorithm: flags.enum({
    char: 'a',
    description: 'matching algorithm to use',
    options: ['ssim', 'matching-pixels'],
    default: 'ssim',
  }),
  iterations: flags.integer({
    char: 'i',
    description: 'number of iterations to perform',
    default: 2,
  }),
  searchWidth: flags.integer({
    char: 'w',
    description: `'width' of the search region (in seconds). the program will find the closest matching frame in this region, OFFSET2 being the center`,
    default: 10,
  }),
  searchResolution: flags.integer({
    char: 'r',
    description: `resolution of the search region (in frames). increases accuracy at the cost of longer runtime`,
    default: 40,
  }),
  verbose: flags.boolean({
    char: 'v',
    description: 'output additional logs',
    default: false,
  }),
}

module.exports = VideoSyncCommand
