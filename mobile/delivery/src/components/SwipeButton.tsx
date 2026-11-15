import { Feather } from '@expo/vector-icons'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Animated, PanResponder, StyleSheet, View } from 'react-native'

import { colors, radius, type } from '@/theme'

const THUMB = 52
const PADDING = 4
// How far the thumb must travel, as a share of the track, to count.
const COMPLETE_AT = 0.85

// "Swipe to confirm", as Swiggy and Zomato use for every delivery step. A tap,
// or two or three taps in a hurry, does nothing: only a deliberate slide all
// the way across moves the order on. Testers marked orders delivered by
// tapping one button several times.
export function SwipeButton({
  label,
  onComplete,
  disabled = false,
  busy = false,
}: {
  label: string
  onComplete: () => void
  disabled?: boolean
  busy?: boolean
}) {
  const [width, setWidth] = useState(0)
  const offset = useRef(new Animated.Value(0)).current
  const travel = Math.max(0, width - THUMB - PADDING * 2)
  const state = useRef({ travel, disabled, busy, onComplete })
  state.current = { travel, disabled, busy, onComplete }

  // Back to the start whenever the step changes or finishes.
  useEffect(() => {
    if (!busy) Animated.spring(offset, { toValue: 0, useNativeDriver: false }).start()
  }, [busy, label, offset])

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !state.current.disabled && !state.current.busy,
      onMoveShouldSetPanResponder: () => !state.current.disabled && !state.current.busy,
      // Keeps the screen from scrolling while the thumb is held.
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, gesture) => {
        offset.setValue(Math.min(Math.max(gesture.dx, 0), state.current.travel))
      },
      onPanResponderRelease: (_, gesture) => {
        const { travel: full } = state.current

        if (full > 0 && gesture.dx >= full * COMPLETE_AT) {
          Animated.timing(offset, { toValue: full, duration: 120, useNativeDriver: false }).start()
          state.current.onComplete()

          // If nothing started (the rider said "Not yet" to a question), slide back.
          setTimeout(() => {
            if (!state.current.busy) Animated.spring(offset, { toValue: 0, useNativeDriver: false }).start()
          }, 500)
        } else {
          Animated.spring(offset, { toValue: 0, useNativeDriver: false }).start()
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(offset, { toValue: 0, useNativeDriver: false }).start()
      },
    }),
  ).current

  const labelOpacity = travel
    ? offset.interpolate({ inputRange: [0, travel * 0.6], outputRange: [1, 0], extrapolate: 'clamp' })
    : 1

  return (
    <View
      style={[styles.track, disabled && styles.trackDisabled]}
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy }}
      // Screen readers cannot swipe: their double tap confirms instead.
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={() => {
        if (!disabled && !busy) onComplete()
      }}
    >
      <Animated.Text style={[styles.label, { opacity: labelOpacity }]} numberOfLines={1}>
        {label}
      </Animated.Text>

      <Animated.View
        style={[styles.thumb, disabled && styles.thumbDisabled, { transform: [{ translateX: offset }] }]}
        {...responder.panHandlers}
      >
        {busy ? (
          <ActivityIndicator color={colors.brand} />
        ) : (
          <Feather name="chevrons-right" size={24} color={disabled ? colors.faint : colors.brand} />
        )}
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  track: {
    height: THUMB + PADDING * 2,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    justifyContent: 'center',
    padding: PADDING,
    overflow: 'hidden',
  },
  trackDisabled: { backgroundColor: colors.line },
  label: {
    ...type.bodyStrong,
    fontSize: 16,
    color: '#fff',
    textAlign: 'center',
    paddingLeft: THUMB,
    position: 'absolute',
    left: 0,
    right: 0,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.md - 2,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbDisabled: { backgroundColor: colors.surface },
})
