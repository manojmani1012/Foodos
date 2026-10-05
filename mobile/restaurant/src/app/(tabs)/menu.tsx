import { Feather } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import {
  deleteMenuItem,
  fetchMenu,
  formatRupees,
  updateMenuItem,
  type MenuCategory,
  type MenuItem,
} from '@/lib/restaurant'
import { colors, radius, shadow, space, type } from '@/theme'

export default function MenuScreen() {
  const router = useRouter()

  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const menu = await fetchMenu()

      setCategories(menu.categories)
      setItems(menu.items)
      setError('')
    } catch (loadError: any) {
      setError(loadError.message || 'Could not load your menu')
    } finally {
      setLoading(false)
    }
  }, [])

  // Reloads when returning from the add screen, so a new item is there.
  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  async function toggleAvailable(item: MenuItem) {
    if (pendingId) return

    const next = !item.isAvailable

    setPendingId(item.id)
    // Optimistic: sold out is a thing people tap in a hurry.
    setItems(current => current.map(i => (i.id === item.id ? { ...i, isAvailable: next } : i)))

    try {
      await updateMenuItem(item.id, { isAvailable: next })
    } catch (toggleError: any) {
      setItems(current =>
        current.map(i => (i.id === item.id ? { ...i, isAvailable: !next } : i)),
      )
      setError(toggleError.message || 'Could not update that item')
    } finally {
      setPendingId(null)
    }
  }

  function confirmDelete(item: MenuItem) {
    Alert.alert('Remove this item?', `"${item.name}" will no longer be on your menu.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const previous = items

          setItems(current => current.filter(i => i.id !== item.id))

          try {
            await deleteMenuItem(item.id)
          } catch (deleteError: any) {
            setItems(previous)
            setError(deleteError.message || 'Could not remove that item')
          }
        },
      },
    ])
  }

  // Items with no category still have to appear somewhere.
  const uncategorised = items.filter(item => !item.categoryId)

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.heading}>Menu</Text>
          <Text style={styles.subheading}>
            {items.length} item{items.length === 1 ? '' : 's'} ·{' '}
            {items.filter(i => !i.isAvailable).length} unavailable
          </Text>
        </View>

        <Pressable style={styles.addButton} onPress={() => router.push('/add-item')}>
          <Feather name="plus" size={16} color="#fff" />
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true)
              await load()
              setRefreshing(false)
            }}
            tintColor={colors.brand}
          />
        }
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {items.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Feather name="book-open" size={26} color={colors.faint} />
            </View>
            <Text style={styles.emptyTitle}>Your menu is empty</Text>
            <Text style={styles.emptyHint}>
              Add your first dish and customers will be able to order it straight away.
            </Text>
            <Pressable style={styles.emptyButton} onPress={() => router.push('/add-item')}>
              <Text style={styles.emptyButtonText}>Add a dish</Text>
            </Pressable>
          </View>
        ) : null}

        {categories.map(category => {
          const inCategory = items.filter(item => item.categoryId === category.id)

          if (inCategory.length === 0) return null

          return (
            <View key={category.id} style={styles.section}>
              <Text style={styles.sectionTitle}>{category.name}</Text>

              {inCategory.map(item => (
                <ItemRow
                  key={item.id}
                  item={item}
                  busy={pendingId === item.id}
                  onToggle={() => toggleAvailable(item)}
                  onDelete={() => confirmDelete(item)}
                />
              ))}
            </View>
          )
        })}

        {uncategorised.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Other</Text>

            {uncategorised.map(item => (
              <ItemRow
                key={item.id}
                item={item}
                busy={pendingId === item.id}
                onToggle={() => toggleAvailable(item)}
                onDelete={() => confirmDelete(item)}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function ItemRow({
  item,
  busy,
  onToggle,
  onDelete,
}: {
  item: MenuItem
  busy: boolean
  onToggle: () => void
  onDelete: () => void
}) {
  return (
    <View style={[styles.itemCard, !item.isAvailable && styles.itemCardOff]}>
      <View style={[styles.vegDot, { borderColor: item.isVeg ? colors.veg : colors.nonVeg }]}>
        <View
          style={[styles.vegDotInner, { backgroundColor: item.isVeg ? colors.veg : colors.nonVeg }]}
        />
      </View>

      <View style={styles.flex}>
        <Text style={styles.itemName} numberOfLines={1}>
          {item.name}
        </Text>
        {item.description ? (
          <Text style={styles.itemDescription} numberOfLines={1}>
            {item.description}
          </Text>
        ) : null}
        <Text style={styles.itemPrice}>{formatRupees(item.pricePaise)}</Text>
      </View>

      <View style={styles.itemActions}>
        <Pressable style={styles.iconButton} onPress={onDelete} hitSlop={6}>
          <Feather name="trash-2" size={16} color={colors.muted} />
        </Pressable>

        <Pressable
          style={[styles.availability, item.isAvailable && styles.availabilityOn]}
          onPress={onToggle}
          disabled={busy}
        >
          <Text
            style={[styles.availabilityText, item.isAvailable && styles.availabilityTextOn]}
          >
            {item.isAvailable ? 'Available' : 'Sold out'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  heading: { ...type.title, color: colors.ink },
  subheading: { ...type.caption, color: colors.muted, marginTop: 2 },

  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  addButtonText: { ...type.smallStrong, color: '#fff' },

  content: { padding: space.lg, paddingBottom: space.xxxl },

  section: { marginBottom: space.xl },
  sectionTitle: { ...type.overline, color: colors.muted, marginBottom: space.sm },

  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    marginBottom: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  itemCardOff: { opacity: 0.6 },

  vegDot: {
    width: 14,
    height: 14,
    borderWidth: 1.5,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vegDotInner: { width: 6, height: 6, borderRadius: radius.pill },

  itemName: { ...type.bodyStrong, color: colors.ink },
  itemDescription: { ...type.caption, color: colors.muted, marginTop: 1 },
  itemPrice: { ...type.smallStrong, color: colors.brand, marginTop: space.xs },

  itemActions: { alignItems: 'flex-end', gap: space.sm },
  iconButton: { padding: 4 },
  availability: {
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.dangerSoft,
  },
  availabilityOn: { backgroundColor: colors.brandSoft },
  availabilityText: { ...type.caption, color: colors.danger },
  availabilityTextOn: { color: colors.brandInk },

  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxxl },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  emptyTitle: { ...type.heading, color: colors.body, marginTop: space.sm },
  emptyHint: {
    ...type.small,
    color: colors.muted,
    textAlign: 'center',
    paddingHorizontal: space.xl,
    lineHeight: 19,
  },
  emptyButton: {
    marginTop: space.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  emptyButtonText: { ...type.bodyStrong, color: '#fff' },

  error: {
    marginBottom: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    ...type.small,
  },
})
