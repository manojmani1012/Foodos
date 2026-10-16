// Build settings that depend on the machine doing the build, layered over
// app.json.
const fs = require('fs')
const path = require('path')

module.exports = ({ config }) => {
  // Firebase's file for Android push notifications. It is not kept in the
  // (public) repo: the APK build writes it from the GOOGLE_SERVICES_JSON
  // secret. Without it the app builds and runs, just without push.
  const hasFirebase = fs.existsSync(path.join(__dirname, 'google-services.json'))

  return {
    ...config,
    android: {
      ...config.android,
      ...(hasFirebase ? { googleServicesFile: './google-services.json' } : {}),
    },
  }
}
