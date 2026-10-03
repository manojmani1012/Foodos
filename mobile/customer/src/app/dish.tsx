import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { useCart } from '@/lib/CartContext'
import { useDish } from '@/lib/DishContext'
import { colors, radius, shadow, space, type } from '@/theme'

import { Header, VegMark } from './cart'

// Choosing add-ons and a quantity before adding to the cart.
//
// The dish and its restaurant are handed over through DishContext rather than
// route params: the menu screen already loaded them, so this screen costs no
// extra request and cannot show a stale price.
export default function DishScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const cart = useCart()
  const { dish, restaurant } = useDish()

  const [quantity, setQuantity] = useState(1)
  const [selected, setSelected] = useState<string[]>([])

  const addOns = useMemo(() => (dish?.addOns ?? []).filter(a => a.isAvailable), [dish])

  if (!dish || !restaurant) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header onBack={() => router.back()} title="Dish" />
        <View style={styles.empty}>
          <Feather name="coffee" size={40} color={colors.faint} />
          <Text style={styles.emptyText}>That dish is no longer available.</Text>
        </View>
      </SafeAreaView>
    )
  }

  const chosen = addOns.filter(a => selected.includes(a.id))
  const addOnTotal = chosen.reduce((sum, a) => sum + a.price, 0)
  const total = (dish.price + addOnTotal) * quantity

  function toggle(id: string) {
    setSelected(previous =>
      previous.includes(id) ? previous.filter(a => a !== id) : [...previous, id],
    )
  }

  const selectedDish = dish
  const selectedRestaurant = restaurant

  function addToCart() {
    // One tap per unit keeps the cart's own quantity logic as the only place
    // that counts, rather than duplicating it here.
    for (let i = 0; i < quantity; i += 1) {
      cart.add(
        selectedRestaurant,
        selectedDish,
        chosen.map(a => ({ id: a.id, label: a.label, price: a.price })),
      )
    }

    router.back()
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header onBack={() => router.back()} title={dish.name} subtitle={restaurant.name} />

      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        <View style={[styles.hero, { backgroundColor: restaurant.color }]}>
          <Text style={styles.heroEmoji}>{dish.emoji}</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.titleRow}>
            <VegMark isVeg={dish.isVeg} />
            {dish.rating ? (
              <Text style={styles.rating}>
                ★ {dish.rating}
                <Text style={styles.ratingCount}> ({dish.ratingCount})</Text>
              </Text>
            ) : null}
          </View>

          <Text style={styles.name}>{dish.name}</Text>
          <Text style={styles.price}>₹{dish.price}</Text>

          {dish.description ? <Text style={styles.description}>{dish.description}</Text> : null}
        </View>

        {addOns.length > 0 && (
          <View style={styles.card}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Add-ons</Text>
              <Text style={styles.sectionHint}>Optional</Text>
            </View>

            {addOns.map((addOn, index) => {
              const checked = selected.includes(addOn.id)

              return (
                <Pressable
                  key={addOn.id}
                  style={[styles.addOn, index > 0 && styles.addOnDivider]}
                  onPress={() => toggle(addOn.id)}
                >
                  <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                    {checked && <Feather name="check" size={13} color={colors.surface} />}
                  </View>
                  <Text style={styles.addOnLabel}>{addOn.label}</Text>
                  <Text style={styles.addOnPrice}>+₹{addOn.price}</Text>
                </Pressable>
              )
            })}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Quantity</Text>

          <View style={styles.quantityRow}>
            <Pressable
              style={[styles.quantityButton, quantity <= 1 && styles.disabled]}
              onPress={() => setQuantity(q => Math.max(1, q - 1))}
              disabled={quantity <= 1}
            >
              <Feather name="minus" size={17} color={colors.brand} />
            </Pressable>

            <Text style={styles.quantityValue}>{quantity}</Text>

            <Pressable
              style={[styles.quantityButton, quantity >= 20 && styles.disabled]}
              onPress={() => setQuantity(q => Math.min(20, q + 1))}
              disabled={quantity >= 20}
            >
              <Feather name="plus" size={17} color={colors.brand} />
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: space.md + insets.bottom }]}>
        <View style={styles.flex}>
          <Text style={styles.barLabel}>
            {quantity} × ₹{(dish.price + addOnTotal).toFixed(0)}
          </Text>
          <Text style={styles.barValue}>₹{total.toFixed(0)}</Text>
        </View>
        <Pressable
          style={[styles.barButton, !dish.isAvailable && styles.disabled]}
          onPress={addToCart}
          disabled={!dish.isAvailable}
        >
          <Text style={styles.barButtonText}>
            {dish.isAvailable ? 'Add to cart' : 'Unavailable'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },

  hero: { height: 180, alignItems: 'center', justifyContent: 'center' },
  heroEmoji: { fontSize: 76 },

  card: {
    marginHorizontal: space.lg,
    marginTop: space.lg,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rating: { ...type.caption, color: colors.star, fontWeight: '700' },
  ratingCount: { color: colors.muted, fontWeight: '500' },
  name: { ...type.display, fontSize: 22, color: colors.ink, marginTop: space.sm },
  price: { ...type.heading, color: colors.ink, marginTop: space.xs },
  description: { ...type.body, color: colors.muted, marginTop: space.md, lineHeight: 22 },

  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { ...type.overline, color: colors.muted },
  sectionHint: { ...type.caption, color: colors.faint },

  addOn: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  addOnDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.brand, borderColor: colors.brand },
  addOnLabel: { flex: 1, ...type.body, color: colors.ink },
  addOnPrice: { ...type.bodyStrong, color: colors.body },

  quantityRow: { flexDirection: 'row', alignItems: 'center', gap: space.xl, marginTop: space.md },
  quantityButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityValue: { ...type.title, color: colors.ink, minWidth: 28, textAlign: 'center' },

  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    ...shadow.bar,
  },
  barLabel: { ...type.caption, color: colors.muted },
  barValue: { ...type.title, color: colors.ink, fontVariant: ['tabular-nums'] },
  barButton: {
    minWidth: 160,
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  barButtonText: { ...type.bodyStrong, color: colors.surface },
  disabled: { opacity: 0.45 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  emptyText: { ...type.body, color: colors.muted },
})
