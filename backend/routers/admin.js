import { Router } from 'express'

const router = Router()

router.get('/dashboard', (request, response) => {
  response.status(501).json({
    ok: false,
    message: 'Admin dashboard API is not implemented yet',
  })
})

router.get('/stats', (request, response) => {
  response.status(501).json({
    ok: false,
    message: 'Admin stats API is not implemented yet',
  })
})

export default router
