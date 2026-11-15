import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'

import { request } from './apiClient'

export type DocumentType = 'driving_license' | 'vehicle_rc' | 'aadhaar'

export type RiderDocument = {
  type: DocumentType
  label: string
  // missing, pending (Foodos is checking), verified or rejected.
  status: 'missing' | 'pending' | 'verified' | 'rejected'
  rejectionReason: string | null
  uploadedAt: string | null
}

// Wide enough to read every line of a licence, small enough to send quickly.
const PHOTO_MAX_WIDTH = 1600
const PHOTO_QUALITY = 0.7

export async function fetchDocuments(): Promise<RiderDocument[]> {
  const { documents } = await request('/api/v1/delivery/documents')

  return documents
}

// Returns a local file ready to upload, or null if the rider backed out.
export async function pickDocumentPhoto(source: 'camera' | 'library'): Promise<string | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 }
  let result: ImagePicker.ImagePickerResult

  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync()

    if (!permission.granted) {
      throw new Error('Allow camera access in your phone settings to photograph your documents')
    }

    result = await ImagePicker.launchCameraAsync(options)
  } else {
    result = await ImagePicker.launchImageLibraryAsync(options)
  }

  if (result.canceled || !result.assets?.[0]) return null

  const asset = result.assets[0]
  const context = ImageManipulator.manipulate(asset.uri)

  if (asset.width > PHOTO_MAX_WIDTH) {
    context.resize({ width: PHOTO_MAX_WIDTH })
  }

  const rendered = await context.renderAsync()
  const saved = await rendered.saveAsync({ compress: PHOTO_QUALITY, format: SaveFormat.JPEG })

  return saved.uri
}

export async function uploadDocument(type: DocumentType, fileUri: string): Promise<RiderDocument[]> {
  const form = new FormData()

  // React Native's FormData takes a file as { uri, name, type } rather than a Blob.
  form.append('file', { uri: fileUri, name: `${type}.jpg`, type: 'image/jpeg' } as any)

  const { documents } = await request(`/api/v1/delivery/documents/${type}`, { method: 'POST', body: form })

  return documents
}
