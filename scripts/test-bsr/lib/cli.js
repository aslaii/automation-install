function parseCliArgs(argv) {
  const args = {
    source: 'file',
    delayMs: 250,
    help: false,
    metric: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--bsr':
        args.metric = 'bsr';
        break;
      case '--date':
        args.date = requireValue(argv, ++i, '--date');
        break;
      case '--end-date':
        args.endDate = requireValue(argv, ++i, '--end-date');
        break;
      case '--source':
        args.source = requireValue(argv, ++i, '--source');
        break;
      case '--delay-ms':
        args.delayMs = Number(requireValue(argv, ++i, '--delay-ms'));
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

module.exports = {
  parseCliArgs,
};
