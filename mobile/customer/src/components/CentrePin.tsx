import { Feather } from '@expo/vector-icons'
import { StyleSheet, Text, View } from 'react-native'

import { colors, radius, shadow, space, type } from '@/theme'

// The pin fixed in the middle of the map. The point of the pin sits exactly on
// the map's centre, which is the location saved; it lifts while the map moves.
export function CentrePin({ lifted }: { lifted: boolean }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Anchored by its bottom edge to the middle of the map. */}
      <View style={[styles.stack, lifted && styles.lifted]}>
        <View style={styles.bubble}>
          <Text style={styles.bubbleText}>Your order will be delivered here</Text>
        </View>
        <Feather name="map-pin" size={40} color={colors.brand} />
      </View>
      <View style={styles.dot} />
    </View>
  )
}

const styles = StyleSheet.create({
  stack: { position: 'absolute', left: 0, right: 0, bottom: '50%', alignItems: 'center' },
  lifted: { transform: [{ translateY: -8 }] },
  bubble: {
    marginBottom: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    ...shadow.card,
  },
  bubbleText: { ...type.caption, color: colors.surface, fontWeight: '600' },
  // The exact spot, under the tip of the pin.
  dot: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 8,
    height: 8,
    marginLeft: -4,
    marginTop: -4,
    borderRadius: 4,
    backgroundColor: colors.brand,
    opacity: 0.45,
  },
})
