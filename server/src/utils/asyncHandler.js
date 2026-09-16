/**
 * Express 4 does not forward a rejected promise from an async handler to the
 * error middleware. An async route that throws after an `await` therefore sends
 * no response at all: the request hangs until the client gives up, the browser
 * never even gets an error, and the browser console shows nothing useful.
 *
 * Wrapping every async handler in this turns that rejection into a normal
 * `next(err)`, so the JSON error handler in app.js always answers.
 */
function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;