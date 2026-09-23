// Wraps an async route handler so thrown errors reach Express's error
// middleware instead of crashing the process or needing try/catch in
// every controller.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
