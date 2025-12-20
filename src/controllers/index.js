// Controllers for handling HTTP requests

const UploadController = require('./uploadController');
const ProcessingController = require('./processingController');
const ResultsController = require('./resultsController');
const CleanupController = require('./cleanupController');

module.exports = {
  UploadController,
  ProcessingController,
  ResultsController,
  CleanupController,
};
