export function notFoundHandler(request, response) {
  response.status(404).json({
    ok: false,
    message: 'Route not found',
    path: request.originalUrl,
  })
}
