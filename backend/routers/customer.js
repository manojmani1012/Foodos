import { Router } from 'express'

const router = Router()

router.get('/profile', (request, response) => {
  response.status(501).json({
    ok: false,
    message: 'Customer profile API is not implemented yet',
  })
})

router.get('/orders', (request, response) => {
  response.status(501).json({
    ok: false,
    message: 'Customer orders API is not implemented yet',
  })
})

export default router
