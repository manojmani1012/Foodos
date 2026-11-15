// The rider's licence, RC and Aadhaar: photograph each one, then Foodos checks
// it. A rejected document shows Foodos's reason and can be sent again.

import { Feather } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native'

import { fetchDocuments, pickDocumentPhoto, uploadDocument, type DocumentType, type RiderDocument } from '@/lib/documents'
import { colors, radius, space, type } from '@/theme'

const STATUS: Record<RiderDocument['status'], { label: string; tone: string; soft: string; icon: keyof typeof Feather.glyphMap }> = {
  missing: { label: 'Not uploaded', tone: colors.muted, soft: colors.ground, icon: 'upload' },
  pending: { label: 'Foodos is checking', tone: colors.warning, soft: colors.warningSoft, icon: 'clock' },
  verified: { label: 'Approved', tone: colors.brandInk, soft: colors.brandSoft, icon: 'check-circle' },
  rejected: { label: 'Send again', tone: colors.danger, soft: colors.dangerSoft, icon: 'alert-circle' },
}

const HINTS: Record<DocumentType, string> = {
  driving_license: 'Front side, with your photo and licence number readable.',
  vehicle_rc: 'The registration certificate of the vehicle you deliver on.',
  aadhaar: 'Use a masked Aadhaar (only the last 4 digits showing). Download it free from myAadhaar.',
}

export function DocumentsCard() {
  const [documents, setDocuments] = useState<RiderDocument[] | null>(null)
  const [busy, setBusy] = useState<DocumentType | null>(null)
  const [error, setError] = useState('')

  useFocusEffect(
    useCallback(() => {
      fetchDocuments()
        .then(setDocuments)
        .catch((loadError: any) => setError(loadError.message || 'Could not load your documents'))
    }, []),
  )

  async function send(doc: RiderDocument, source: 'camera' | 'library') {
    setError('')

    try {
      const file = await pickDocumentPhoto(source)

      if (!file) return

      setBusy(doc.type)
      setDocuments(await uploadDocument(doc.type, file))
    } catch (sendError: any) {
      setError(sendError.message || 'Could not send the photo')
    } finally {
      setBusy(null)
    }
  }

  function choose(doc: RiderDocument) {
    Alert.alert(doc.label, HINTS[doc.type], [
      { text: 'Take a photo', onPress: () => send(doc, 'camera') },
      { text: 'Choose from gallery', onPress: () => send(doc, 'library') },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  const done = documents?.filter(doc => doc.status === 'verified').length ?? 0

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Documents</Text>
      <Text style={styles.subtitle}>
        {documents ? `${done} of ${documents.length} approved. Foodos checks each one before your first delivery.` : 'Loading…'}
      </Text>

      {documents?.map(doc => {
        const status = STATUS[doc.status]
        const canSend = doc.status !== 'verified' && busy === null

        return (
          <Pressable
            key={doc.type}
            style={styles.row}
            onPress={() => choose(doc)}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel={`${doc.label}: ${status.label}`}
          >
            <View style={[styles.icon, { backgroundColor: status.soft }]}>
              {busy === doc.type ? (
                <ActivityIndicator size="small" color={colors.brand} />
              ) : (
                <Feather name={status.icon} size={18} color={status.tone} />
              )}
            </View>
            <View style={styles.flex}>
              <Text style={styles.label}>{doc.label}</Text>
              <Text style={[styles.status, { color: status.tone }]}>
                {doc.status === 'rejected' && doc.rejectionReason ? `Not accepted: ${doc.rejectionReason}` : status.label}
              </Text>
            </View>
            {canSend ? (
              <Text style={styles.action}>{doc.status === 'missing' ? 'Upload' : doc.status === 'rejected' ? 'Send again' : 'Replace'}</Text>
            ) : null}
          </Pressable>
        )
      })}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    marginTop: space.xl,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  title: { ...type.overline, color: colors.muted },
  subtitle: { ...type.small, color: colors.body, marginTop: space.xs, marginBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  icon: { width: 38, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  label: { ...type.bodyStrong, color: colors.ink },
  status: { ...type.caption, marginTop: 2 },
  action: { ...type.smallStrong, color: colors.brand },
  error: { ...type.caption, color: colors.danger, marginTop: space.sm },
})
