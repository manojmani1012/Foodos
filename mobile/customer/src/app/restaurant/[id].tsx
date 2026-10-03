import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { useCart } from '@/lib/CartContext'
import { useDish } from '@/lib/DishContext'
import { fetchRestaurant, type MenuCategory, type MenuItem, type Restaurant } from '@/lib/catalogue'
import { colors, radius, shadow, space, type } from '@/theme'

const TAB_BAR_HEIGHT = 56

export default function RestaurantScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const cart = useCart()
  const dishes = useDish()

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const sectionList = useRef<SectionList<MenuItem, MenuCategory & { data: MenuItem[] }> | null>(null)

  const load = useCallback(async () => {
    if (!id) return

    setError('')

    try {
      // One request brings the restaurant, every category, every dish and every
      // add-on.
      const data = await fetchRestaurant(id)

      setRestaurant(data.restaurant)
      setCategories(data.categories)
      setActiveCategory(data.categories[0]?.name ?? null)
    } catch (loadError: any) {
      setError(loadError.message || 'Could not load this menu')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={colors.brand} />
      </SafeAreaView>
    )
  }

  if (error || !restaurant) {
    return (
      <SafeAreaView style={styles.centered}>
        <Feather name="wifi-off" size={40} color={colors.faint} />
        <Text style={styles.emptyText}>{error || 'That restaurant is unavailable'}</Text>
        <View style={styles.errorActions}>
          <Pressable style={styles.ghostButton} onPress={load}>
            <Text style={styles.ghostButtonText}>Try again</Text>
          </Pressable>
          <Pressable style={styles.ghostButton} onPress={() => router.back()}>
            <Text style={styles.ghostButtonText}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  const sections = categories
    .filter(category => category.items.length > 0)
    .map(category => ({ ...category, data: category.items }))

  function jumpToCategory(name: string) {
    setActiveCategory(name)

    const index = sections.findIndex(section => section.name === name)

    if (index >= 0) {
      sectionList.current?.scrollToLocation({
        sectionIndex: index,
        itemIndex: 0,
        viewPosition: 0,
        animated: true,
      })
    }
  }

  const cartIsThisRestaurant = cart.restaurant?.id === restaurant.id
  const showCartBar = cart.count > 0 && cartIsThisRestaurant

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={14} style={styles.backButton}>
          <Feather name="chevron-left" size={24} color={colors.ink} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {restaurant.name}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {restaurant.eta} · {restaurant.address}
          </Text>
        </View>
      </View>

      {sections.length > 1 && (
        /* A fixed-height row. Without it the horizontal list stretches to fill
           the screen and the pill radius turns every chip into a circle. */
        <View style={styles.tabBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabBarContent}
          >
            {sections.map(section => {
              const active = activeCategory === section.name

              return (
                <Pressable
                  key={section.id}
                  style={[styles.tab, active && styles.tabActive]}
                  onPress={() => jumpToCategory(section.name)}
                >
                  <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
                    {section.name}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      )}

      <SectionList
        ref={sectionList}
        sections={sections}
        keyExtractor={item => item.id}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        onScrollToIndexFailed={info => {
          // Rows vary in height, so a jump can outrun measurement; retry once
          // the list has caught up.
          setTimeout(() => {
            sectionList.current?.scrollToLocation({
              sectionIndex: info.index,
              itemIndex: 0,
              animated: true,
            })
          }, 120)
        }}
        ListHeaderComponent={<RestaurantHero restaurant={restaurant} />}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>{section.name}</Text>
            <Text style={styles.sectionHeaderCount}>{section.data.length}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <MenuRow
            item={item}
            quantity={cartIsThisRestaurant ? cart.quantityOf(item.id) : 0}
            onOpen={() => {
              dishes.open(restaurant, item)
              router.push('/dish')
            }}
            onAdd={() => {
              // A dish with choices opens its detail screen; a plain one is
              // added straight away, so the common case stays a single tap.
              if (item.addOns.some(addOn => addOn.isAvailable)) {
                dishes.open(restaurant, item)
                router.push('/dish')
                return
              }

              cart.add(restaurant, item)
            }}
            onIncrement={() => {
              const line = cart.lines.find(l => l.item.id === item.id)
              if (line) cart.increment(line.key)
            }}
            onDecrement={() => {
              const line = cart.lines.find(l => l.item.id === item.id)
              if (line) cart.decrement(line.key)
            }}
          />
        )}
        ListEmptyComponent={
          <View style={styles.centeredBlock}>
            <Feather name="coffee" size={40} color={colors.faint} />
            <Text style={styles.emptyText}>This menu is empty right now</Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: showCartBar ? 110 : space.xxl }}
      />

      {showCartBar && (
        <View style={[styles.cartBar, { paddingBottom: space.md + insets.bottom }]}>
          <View style={styles.flex}>
            <Text style={styles.cartBarCount}>
              {cart.count} item{cart.count === 1 ? '' : 's'}
            </Text>
            <Text style={styles.cartBarTotal}>₹{cart.subtotal.toFixed(0)}</Text>
          </View>
          <Pressable style={styles.cartBarButton} onPress={() => router.push('/cart')}>
            <Text style={styles.cartBarButtonText}>View cart</Text>
            <Feather name="chevron-right" size={18} color={colors.surface} />
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  )
}

function RestaurantHero({ restaurant }: { restaurant: Restaurant }) {
  return (
    <View style={styles.hero}>
      <View style={[styles.heroArt, { backgroundColor: restaurant.color }]}>
        <Text style={styles.heroEmoji}>{restaurant.emoji}</Text>
      </View>

      <View style={styles.heroCard}>
        <Text style={styles.heroName}>{restaurant.name}</Text>
        <Text style={styles.heroCuisine} numberOfLines={1}>
          {restaurant.cuisine}
        </Text>

        <View style={styles.heroStats}>
          <View style={styles.heroStat}>
            <Text style={styles.heroStatValue}>★ {restaurant.rating}</Text>
            <Text style={styles.heroStatLabel}>
              {restaurant.ratingCount > 999
                ? `${(restaurant.ratingCount / 1000).toFixed(1)}k ratings`
                : `${restaurant.ratingCount} ratings`}
            </Text>
          </View>
          <View style={styles.heroDivider} />
          <View style={styles.heroStat}>
            <Text style={styles.heroStatValue}>{restaurant.eta.replace(' min', '')}</Text>
            <Text style={styles.heroStatLabel}>minutes</Text>
          </View>
          <View style={styles.heroDivider} />
          <View style={styles.heroStat}>
            <Text style={styles.heroStatValue}>{restaurant.delivery.replace(' Delivery', '')}</Text>
            <Text style={styles.heroStatLabel}>delivery</Text>
          </View>
        </View>

        {restaurant.isVeg && (
          <View style={styles.vegBadge}>
            <Text style={styles.vegBadgeText}>PURE VEG</Text>
          </View>
        )}

        {!restaurant.isAcceptingOrders && (
          <View style={styles.closedBanner}>
            <Text style={styles.closedText}>Not accepting orders right now</Text>
          </View>
        )}
      </View>
    </View>
  )
}

function MenuRow({
  item,
  quantity,
  onOpen,
  onAdd,
  onIncrement,
  onDecrement,
}: {
  item: MenuItem
  quantity: number
  onOpen: () => void
  onAdd: () => void
  onIncrement: () => void
  onDecrement: () => void
}) {
  const unavailable = !item.isAvailable

  return (
    <View style={[styles.row, unavailable && styles.rowUnavailable]}>
      <Pressable style={styles.rowBody} onPress={onOpen} disabled={unavailable}>
        <View style={styles.rowTopLine}>
          <VegMark isVeg={item.isVeg} />
          {item.rating ? (
            <Text style={styles.rowRating}>
              ★ {item.rating}
              <Text style={styles.rowRatingCount}> ({item.ratingCount})</Text>
            </Text>
          ) : null}
        </View>

        <Text style={styles.rowName}>{item.name}</Text>
        <Text style={styles.rowPrice}>₹{item.price}</Text>

        {item.description ? (
          <Text style={styles.rowDesc} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}

        {item.addOns.length > 0 && !unavailable ? (
          <Text style={styles.rowAddons}>
            {item.addOns.length} add-on{item.addOns.length === 1 ? '' : 's'} · customise
          </Text>
        ) : null}
      </Pressable>

      <View style={styles.rowRight}>
        <View style={styles.rowImage}>
          <Text style={styles.rowEmoji}>{item.emoji}</Text>
        </View>

        <View style={styles.rowAction}>
          {unavailable ? (
            <View style={styles.soldOutPill}>
              <Text style={styles.soldOutText}>Sold out</Text>
            </View>
          ) : quantity > 0 ? (
            <View style={styles.stepper}>
              <Pressable style={styles.stepperButton} onPress={onDecrement} hitSlop={6}>
                <Feather name="minus" size={14} color={colors.surface} />
              </Pressable>
              <Text style={styles.stepperCount}>{quantity}</Text>
              <Pressable style={styles.stepperButton} onPress={onIncrement} hitSlop={6}>
                <Feather name="plus" size={14} color={colors.surface} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
              onPress={onAdd}
            >
              <Text style={styles.addButtonText}>ADD</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  )
}

function VegMark({ isVeg }: { isVeg: boolean }) {
  const tint = isVeg ? colors.veg : colors.nonVeg

  return (
    <View style={[styles.vegMark, { borderColor: tint }]}>
      <View style={[styles.vegMarkInner, { backgroundColor: tint }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ground,
    gap: space.sm,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  backButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 30, color: colors.ink, lineHeight: 34 },
  headerText: { flex: 1 },
  headerTitle: { ...type.heading, color: colors.ink },
  headerSub: { ...type.caption, color: colors.muted, marginTop: 1 },

  tabBar: {
    height: TAB_BAR_HEIGHT,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  tabBarContent: {
    paddingHorizontal: space.lg,
    gap: space.sm,
    alignItems: 'center',
    // Fills the bar vertically so each chip is centred rather than stretched.
    height: TAB_BAR_HEIGHT,
  },
  tab: {
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.ground,
    borderWidth: 1,
    borderColor: colors.line,
  },
  tabActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  tabText: { ...type.smallStrong, color: colors.body },
  tabTextActive: { color: colors.surface },

  hero: { backgroundColor: colors.surface, paddingBottom: space.lg },
  heroArt: { height: 150, alignItems: 'center', justifyContent: 'center' },
  heroEmoji: { fontSize: 64 },
  heroCard: {
    marginHorizontal: space.lg,
    marginTop: -space.xxl,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.raised,
  },
  heroName: { ...type.display, color: colors.ink },
  heroCuisine: { ...type.small, color: colors.muted, marginTop: space.xs },
  heroStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatValue: { ...type.bodyStrong, color: colors.ink },
  heroStatLabel: { ...type.caption, color: colors.muted, marginTop: 2 },
  heroDivider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: colors.line },
  vegBadge: {
    alignSelf: 'flex-start',
    marginTop: space.md,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  vegBadgeText: { ...type.overline, color: colors.brandInk },
  closedBanner: {
    marginTop: space.md,
    padding: space.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
  },
  closedText: { ...type.smallStrong, color: colors.danger, textAlign: 'center' },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
  sectionHeaderText: { ...type.overline, color: colors.body, letterSpacing: 1.1 },
  sectionHeaderCount: { ...type.caption, color: colors.faint },

  row: {
    flexDirection: 'row',
    gap: space.lg,
    marginHorizontal: space.lg,
    marginBottom: space.md,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  rowUnavailable: { opacity: 0.55 },
  rowBody: { flex: 1, paddingRight: space.xs },
  rowTopLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  rowRating: { ...type.caption, color: colors.star, fontWeight: '700' },
  rowRatingCount: { color: colors.muted, fontWeight: '500' },
  rowName: { ...type.bodyStrong, fontSize: 16, color: colors.ink },
  rowPrice: { ...type.bodyStrong, color: colors.ink, marginTop: space.xs },
  rowDesc: { ...type.small, color: colors.muted, marginTop: space.sm },
  rowAddons: { ...type.caption, color: colors.brand, marginTop: space.sm, fontWeight: '600' },

  rowRight: { width: 104, alignItems: 'center' },
  rowImage: {
    width: 104,
    height: 92,
    borderRadius: radius.md,
    backgroundColor: colors.ground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowEmoji: { fontSize: 38 },
  // Overlaps the image, the way food apps place the action.
  rowAction: { marginTop: -18, alignItems: 'center' },

  addButton: {
    minWidth: 88,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.brand,
    alignItems: 'center',
    ...shadow.card,
  },
  addButtonPressed: { backgroundColor: colors.brandSoft },
  addButtonText: { ...type.smallStrong, color: colors.brand, letterSpacing: 0.8 },

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 88,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
    ...shadow.card,
  },
  stepperButton: { width: 30, height: 36, alignItems: 'center', justifyContent: 'center' },
  stepperSign: { color: colors.surface, fontSize: 18, fontWeight: '700', lineHeight: 22 },
  stepperCount: {
    flex: 1,
    textAlign: 'center',
    color: colors.surface,
    ...type.smallStrong,
  },

  soldOutPill: {
    minWidth: 88,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.ground,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: 'center',
  },
  soldOutText: { ...type.caption, color: colors.muted, fontWeight: '700' },

  vegMark: {
    width: 16,
    height: 16,
    borderWidth: 1.5,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vegMarkInner: { width: 8, height: 8, borderRadius: 4 },

  cartBar: {
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
  cartBarCount: { ...type.caption, color: colors.muted },
  cartBarTotal: { ...type.title, color: colors.ink },
  cartBarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  cartBarButtonText: { ...type.bodyStrong, color: colors.surface },
  cartBarArrow: { color: colors.surface, fontSize: 20, lineHeight: 22 },

  centeredBlock: { alignItems: 'center', paddingVertical: space.xxxl, gap: space.sm },
  emptyEmoji: { fontSize: 40 },
  emptyText: { ...type.body, color: colors.muted, textAlign: 'center', paddingHorizontal: space.xxl },
  errorActions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  ghostButton: {
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  ghostButtonText: { ...type.smallStrong, color: colors.brand },
})
