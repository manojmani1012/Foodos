import { Router } from 'express'

const router = Router()

router.post('/otp/request', (request, response) => {
  response.status(501).json({
    ok: false,
    message: 'OTP request is not implemented yet',
  })
})

router.post('/otp/verify', (request, response) => {
  response.status(501).json({
    ok: false,
    message: 'OTP verification is not implemented yet',
  })
})

router.post('/logout', (request, response) => {
  response.status(501).json({
    ok: false,
    message: 'Logout is not implemented yet',
  })
})

export default router
