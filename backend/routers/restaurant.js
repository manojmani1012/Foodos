import { Router } from 'express'

const router = Router()

router.get('/dashboard', (request, response) => {
  response.status(501).json({
    ok: false,
    message: 'Restaurant dashboard API is not implemented yet',
  })
})

router.get('/orders', (request, response) => {
  response.status(501).json({
    ok: false,
    message: 'Restaurant orders API is not implemented yet',
  })
})

export default router
