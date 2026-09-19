export function errorHandler(error, request, response, next) {
  response.status(error.status || 500).json({
    ok: false,
    message: error.message || 'Internal server error',
  })
}
