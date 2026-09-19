import 'dotenv/config'
import app from './app.js'
import { getEnvironment } from './config/environment.js'

const { port } = getEnvironment()

app.listen(port, () => {
	console.log(`Foodos backend running on http://localhost:${port}`)
})
