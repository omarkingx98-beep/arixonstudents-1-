import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  runTransaction,
  serverTimestamp,
  increment
} from 'firebase/firestore';
import { db, auth } from './firebase';
import type { 
  StoreItem, 
  UserInventoryItem, 
  StoreTransaction, 
  EconomySettings, 
  StoreCategoryType, 
  StoreItemType,
  UserEquippedLoadout
} from '../types/economy';
import type { UserProfile } from '../types';
import { DEFAULT_ECONOMY_SETTINGS, INITIAL_STORE_ITEMS } from '../data/defaultStoreItems';

const STORE_ITEMS_COLLECTION = 'storeItems';
const USER_INVENTORY_COLLECTION = 'userInventory';
const STORE_TRANSACTIONS_COLLECTION = 'storeTransactions';
const ECONOMY_SETTINGS_COLLECTION = 'economySettings';
const ECONOMY_SETTINGS_DOC_ID = 'global_settings';

/**
 * Ensures initial store items and settings are seeded in Firestore if collection is empty
 */
export async function ensureStoreSeeded(): Promise<void> {
  try {
    const itemsRef = collection(db, STORE_ITEMS_COLLECTION);
    const snap = await getDocs(query(itemsRef, limit(1)));
    if (snap.empty) {
      console.log('[PointEconomyService] Seeding default store items to Firestore...');
      for (const item of INITIAL_STORE_ITEMS) {
        try {
          await setDoc(doc(db, STORE_ITEMS_COLLECTION, item.id), item);
        } catch (e) {
          // Normal for non-admin users where write is restricted
        }
      }
      console.log('[PointEconomyService] Finished store items check.');
    }

    // Check settings
    const settingsRef = doc(db, ECONOMY_SETTINGS_COLLECTION, ECONOMY_SETTINGS_DOC_ID);
    const settingsSnap = await getDoc(settingsRef);
    if (!settingsSnap.exists()) {
      try {
        await setDoc(settingsRef, DEFAULT_ECONOMY_SETTINGS);
      } catch (e) {
        // Normal for non-admin users
      }
    }
  } catch (err) {
    // Graceful fallback for non-admin or unauthenticated read
    console.warn('[PointEconomyService] Seeding check notice (ignorable for students):', err);
  }
}

/**
 * Fetch active store items, optionally filtered by category
 */
export async function getStoreItems(category?: StoreCategoryType): Promise<StoreItem[]> {
  try {
    await ensureStoreSeeded();

    const itemsRef = collection(db, STORE_ITEMS_COLLECTION);
    let q;
    if (category) {
      q = query(itemsRef, where('category', '==', category), where('active', '==', true));
    } else {
      q = query(itemsRef, where('active', '==', true));
    }

    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      // Fallback to local default items if network or query delay
      return INITIAL_STORE_ITEMS.filter(i => i.active && (!category || i.category === category));
    }

    const now = new Date().toISOString();
    const items: StoreItem[] = [];
    snapshot.forEach((docSnap) => {
      const item = docSnap.data() as StoreItem;
      // Filter out expired limited-time items
      if (item.limited && item.endAt && item.endAt < now) {
        return;
      }
      items.push(item);
    });

    return items;
  } catch (err) {
    console.warn('[PointEconomyService] Notice fetching store items, using local catalog:', err);
    return INITIAL_STORE_ITEMS.filter(i => i.active && (!category || i.category === category));
  }
}

/**
 * Fetch a single store item by ID
 */
export async function getStoreItemById(itemId: string): Promise<StoreItem | null> {
  try {
    const itemRef = doc(db, STORE_ITEMS_COLLECTION, itemId);
    const snap = await getDoc(itemRef);
    if (snap.exists()) {
      return snap.data() as StoreItem;
    }
    const found = INITIAL_STORE_ITEMS.find(i => i.id === itemId);
    return found || null;
  } catch (err) {
    console.warn('[PointEconomyService] Notice fetching item:', itemId, err);
    return INITIAL_STORE_ITEMS.find(i => i.id === itemId) || null;
  }
}

/**
 * Fetch all inventory items owned by a user
 */
export async function getUserInventory(userId: string): Promise<UserInventoryItem[]> {
  try {
    const invRef = collection(db, USER_INVENTORY_COLLECTION);
    const q = query(invRef, where('userId', '==', userId));
    const snapshot = await getDocs(q);

    const inventory: UserInventoryItem[] = [];
    snapshot.forEach((docSnap) => {
      inventory.push(docSnap.data() as UserInventoryItem);
    });

    if (inventory.length > 0) {
      try {
        localStorage.setItem(`arixon_inventory_${userId}`, JSON.stringify(inventory));
      } catch {}
    }

    return inventory;
  } catch (err) {
    console.warn('[PointEconomyService] Reading inventory from local cache for user:', userId);
    try {
      const cached = localStorage.getItem(`arixon_inventory_${userId}`);
      if (cached) {
        return JSON.parse(cached) as UserInventoryItem[];
      }
    } catch {}
    return [];
  }
}

/**
 * Fetch transaction history for a user
 */
export async function getUserTransactions(userId: string, limitCount = 30): Promise<StoreTransaction[]> {
  try {
    const txRef = collection(db, STORE_TRANSACTIONS_COLLECTION);
    const q = query(
      txRef, 
      where('userId', '==', userId), 
      orderBy('timestamp', 'desc'), 
      limit(limitCount)
    );
    const snapshot = await getDocs(q);

    const transactions: StoreTransaction[] = [];
    snapshot.forEach((docSnap) => {
      transactions.push(docSnap.data() as StoreTransaction);
    });

    return transactions;
  } catch (err) {
    console.warn('[PointEconomyService] Note on user transactions fetch:', err);
    return [];
  }
}

/**
 * Execute an atomic in-app purchase using Spendable Points
 * Strict server-side or atomic Firestore validation:
 * 1. Checks user exists
 * 2. Checks sufficient spendablePoints
 * 3. Checks if non-consumable item is already owned
 * 4. Deducts spendablePoints (NEVER competitionPoints)
 * 5. Adds or updates userInventory
 * 6. Records immutable storeTransaction
 */
export async function purchaseStoreItem(
  userId: string, 
  itemId: string, 
  userDisplayName?: string
): Promise<{ success: boolean; error?: string; newBalance?: number; inventoryItem?: UserInventoryItem }> {
  // 1. Try server-side endpoint first (Admin privileges, no client permission errors)
  try {
    const user = auth.currentUser;
    if (user) {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/store/purchase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          itemId,
          userDisplayName,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        // Update local cache
        try {
          const invKey = `arixon_inventory_${userId}`;
          const currentInvRaw = localStorage.getItem(invKey);
          const currentInv: UserInventoryItem[] = currentInvRaw ? JSON.parse(currentInvRaw) : [];
          const existingIdx = currentInv.findIndex(i => i.itemId === itemId);
          if (existingIdx >= 0) {
            currentInv[existingIdx] = data.inventoryItem;
          } else {
            currentInv.push(data.inventoryItem);
          }
          localStorage.setItem(invKey, JSON.stringify(currentInv));
        } catch {}

        // Notify app
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('arixon:inventory_updated', { detail: { item: data.inventoryItem } }));
          window.dispatchEvent(new CustomEvent('arixon:student_updated', { detail: { studentId: userId, spendablePoints: data.newBalance } }));
        }

        return {
          success: true,
          newBalance: data.newBalance,
          inventoryItem: data.inventoryItem,
        };
      } else {
        const errJson = await response.json().catch(() => ({}));
        if (errJson?.error) {
          return { success: false, error: errJson.error };
        }
      }
    }
  } catch (apiErr) {
    console.warn('[PointEconomyService] Server purchase API note, attempting client fallback:', apiErr);
  }

  // 2. Direct Firestore fallback (student-safe, without unauthorized storeItems writes)
  try {
    const userDocRef = doc(db, 'users', userId);
    const itemDocRef = doc(db, STORE_ITEMS_COLLECTION, itemId);
    const inventoryDocId = `${userId}_${itemId}`;
    const inventoryDocRef = doc(db, USER_INVENTORY_COLLECTION, inventoryDocId);
    const txDocRef = doc(collection(db, STORE_TRANSACTIONS_COLLECTION));

    let resultInventoryItem: UserInventoryItem | undefined;
    let finalSpendableBalance = 0;
    let resolvedItem: StoreItem | null = null;
    const now = new Date().toISOString();

    await runTransaction(db, async (transaction) => {
      // 1. Read User Profile
      const userSnap = await transaction.get(userDocRef);
      if (!userSnap.exists()) {
        throw new Error('لم يتم العثور على حساب الطالب.');
      }
      const userData = userSnap.data() as UserProfile;
      const currentSpendable = typeof userData.spendablePoints === 'number' 
        ? userData.spendablePoints 
        : (userData.totalPoints || 0); // Default migration fallback

      // 2. Read Store Item
      let itemData: StoreItem;
      const itemSnap = await transaction.get(itemDocRef);
      if (itemSnap.exists()) {
        itemData = itemSnap.data() as StoreItem;
      } else {
        const fallback = INITIAL_STORE_ITEMS.find(i => i.id === itemId);
        if (!fallback) throw new Error('العنصر المطلوب غير موجود في المتجر.');
        itemData = fallback;
      }
      resolvedItem = itemData;

      // Check Active & Expiration
      if (!itemData.active) {
        throw new Error('هذا العنصر غير متاح للشراء حالياً.');
      }
      if (itemData.limited && itemData.endAt && itemData.endAt < now) {
        throw new Error('انتهت فترة توفر هذا العنصر المحدود.');
      }

      // 3. Read existing inventory status
      const invSnap = await transaction.get(inventoryDocRef);
      const isAlreadyOwned = invSnap.exists();
      const existingInvData = isAlreadyOwned ? (invSnap.data() as UserInventoryItem) : null;

      if (!itemData.consumable && isAlreadyOwned) {
        throw new Error('أنت تمتلك هذا العنصر التجميلي بالفعل في مخزونك!');
      }

      // 4. Verify Balance
      if (currentSpendable < itemData.price) {
        const missing = itemData.price - currentSpendable;
        throw new Error(`رصيدك من نقاط الشراء غير كافٍ. ينقصك ${missing.toLocaleString()} نقطة شراء.`);
      }

      // 5. Calculate Deductions (Only affects spendablePoints!)
      const newSpendable = currentSpendable - itemData.price;
      finalSpendableBalance = newSpendable;

      // Update User Profile
      transaction.update(userDocRef, {
        spendablePoints: newSpendable,
        updatedAt: now,
      });

      // 6. Update or Create Inventory
      const qtyToAdd = itemData.consumable ? (itemData.quantity || 1) : 1;
      const newQty = existingInvData ? (existingInvData.quantity + qtyToAdd) : qtyToAdd;

      const invData: UserInventoryItem = {
        id: inventoryDocId,
        userId,
        itemId: itemData.id,
        item: itemData,
        quantity: newQty,
        isEquipped: existingInvData?.isEquipped || false,
        acquiredAt: existingInvData?.acquiredAt || now,
        updatedAt: now,
      };
      resultInventoryItem = invData;

      transaction.set(inventoryDocRef, invData, { merge: true });

      // 7. Record Immutable Transaction
      const storeTx: StoreTransaction = {
        id: txDocRef.id,
        userId,
        userDisplayName: userDisplayName || userData.displayName || userData.username,
        type: 'purchase',
        itemId: itemData.id,
        itemName: itemData.name,
        itemRarity: itemData.rarity,
        amount: -itemData.price,
        currency: 'spendable_points',
        previousBalance: currentSpendable,
        newBalance: newSpendable,
        timestamp: now,
        source: 'store_purchase',
        metadata: {
          consumable: itemData.consumable,
          quantityAdded: qtyToAdd,
          category: itemData.category,
        },
      };

      transaction.set(txDocRef, storeTx);
    });

    // Best-effort sales count increment outside student transaction (won't block user if permissions restrict)
    if (resolvedItem) {
      try {
        await updateDoc(itemDocRef, {
          salesCount: ((resolvedItem as any).salesCount || 0) + 1,
          updatedAt: now,
        });
      } catch {}
    }

    if (resultInventoryItem) {
      try {
        const invKey = `arixon_inventory_${userId}`;
        const currentInvRaw = localStorage.getItem(invKey);
        const currentInv: UserInventoryItem[] = currentInvRaw ? JSON.parse(currentInvRaw) : [];
        const existingIdx = currentInv.findIndex(i => i.itemId === itemId);
        if (existingIdx >= 0) {
          currentInv[existingIdx] = resultInventoryItem;
        } else {
          currentInv.push(resultInventoryItem);
        }
        localStorage.setItem(invKey, JSON.stringify(currentInv));
      } catch {}

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('arixon:inventory_updated', { detail: { item: resultInventoryItem } }));
        window.dispatchEvent(new CustomEvent('arixon:student_updated', { detail: { studentId: userId, spendablePoints: finalSpendableBalance } }));
      }
    }

    return {
      success: true,
      newBalance: finalSpendableBalance,
      inventoryItem: resultInventoryItem,
    };
  } catch (err: any) {
    console.error('[PointEconomyService] Purchase failed:', err);
    return {
      success: false,
      error: err?.message || 'تعذر إتمام عملية الشراء. يرجى المحاولة مرة أخرى.',
    };
  }
}

/**
 * Equip a cosmetic item from inventory to student profile
 */
export async function equipCosmetic(
  userId: string,
  itemId: string,
  itemType: StoreItemType
): Promise<{ success: boolean; error?: string }> {
  try {
    const userDocRef = doc(db, 'users', userId);
    const inventoryDocId = `${userId}_${itemId}`;
    const invDocRef = doc(db, USER_INVENTORY_COLLECTION, inventoryDocId);

    // Verify ownership
    const invSnap = await getDoc(invDocRef);
    if (!invSnap.exists()) {
      return { success: false, error: 'أنت لا تملك هذا العنصر في مخزونك.' };
    }

    const updates: Record<string, any> = {
      updatedAt: new Date().toISOString(),
    };

    if (itemType === 'cosmetic_frame') {
      updates.equippedFrameId = itemId;
    } else if (itemType === 'cosmetic_name_effect') {
      updates.equippedNameEffectId = itemId;
    } else if (itemType === 'cosmetic_title') {
      updates.equippedTitleId = itemId;
    } else if (itemType === 'cosmetic_theme') {
      updates.equippedThemeId = itemId;
    } else if (itemType === 'cosmetic_badge') {
      const userSnap = await getDoc(userDocRef);
      const currentBadges: string[] = userSnap.data()?.featuredBadgeIds || [];
      if (!currentBadges.includes(itemId)) {
        if (currentBadges.length >= 5) {
          // Replace the oldest
          updates.featuredBadgeIds = [...currentBadges.slice(1), itemId];
        } else {
          updates.featuredBadgeIds = [...currentBadges, itemId];
        }
      }
    }

    await updateDoc(userDocRef, updates);
    await updateDoc(invDocRef, { isEquipped: true, updatedAt: new Date().toISOString() });

    return { success: true };
  } catch (err: any) {
    console.error('[PointEconomyService] Equip cosmetic error:', err);
    return { success: false, error: err?.message || 'فشل تجهيز العنصر.' };
  }
}

/**
 * Unequip a cosmetic item from student profile
 */
export async function unequipCosmetic(
  userId: string,
  itemType: StoreItemType,
  itemId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const userDocRef = doc(db, 'users', userId);
    const updates: Record<string, any> = {
      updatedAt: new Date().toISOString(),
    };

    if (itemType === 'cosmetic_frame') {
      updates.equippedFrameId = null;
    } else if (itemType === 'cosmetic_name_effect') {
      updates.equippedNameEffectId = null;
    } else if (itemType === 'cosmetic_title') {
      updates.equippedTitleId = null;
    } else if (itemType === 'cosmetic_theme') {
      updates.equippedThemeId = null;
    } else if (itemType === 'cosmetic_badge' && itemId) {
      const userSnap = await getDoc(userDocRef);
      const currentBadges: string[] = userSnap.data()?.featuredBadgeIds || [];
      updates.featuredBadgeIds = currentBadges.filter(id => id !== itemId);
    }

    await updateDoc(userDocRef, updates);

    if (itemId) {
      const invDocRef = doc(db, USER_INVENTORY_COLLECTION, `${userId}_${itemId}`);
      await updateDoc(invDocRef, { isEquipped: false, updatedAt: new Date().toISOString() }).catch(() => {});
    }

    return { success: true };
  } catch (err: any) {
    console.error('[PointEconomyService] Unequip cosmetic error:', err);
    return { success: false, error: err?.message || 'فشل إزالة العنصر.' };
  }
}

/**
 * Consume an exam assistance item atomically in Firestore during an active exam
 */
export async function consumeExamItem(
  userId: string,
  itemId: string,
  examId: string,
  attemptId: string
): Promise<{ success: boolean; error?: string; remainingQuantity?: number; effect?: StoreItem['effectConfig'] }> {
  try {
    const inventoryDocId = `${userId}_${itemId}`;
    const invDocRef = doc(db, USER_INVENTORY_COLLECTION, inventoryDocId);
    const txDocRef = doc(collection(db, STORE_TRANSACTIONS_COLLECTION));

    let remaining = 0;
    let itemEffect: StoreItem['effectConfig'] | undefined;

    await runTransaction(db, async (transaction) => {
      const invSnap = await transaction.get(invDocRef);
      if (!invSnap.exists()) {
        throw new Error('لا تملك هذه الأداة في مخزونك.');
      }
      const invData = invSnap.data() as UserInventoryItem;
      if (invData.quantity <= 0) {
        throw new Error('نفدت كمية هذه الأداة من مخزونك. يمكنك شراؤها من المتجر.');
      }

      remaining = invData.quantity - 1;
      itemEffect = invData.item.effectConfig;

      transaction.update(invDocRef, {
        quantity: remaining,
        updatedAt: new Date().toISOString(),
      });

      // Record transaction
      const storeTx: StoreTransaction = {
        id: txDocRef.id,
        userId,
        type: 'usage',
        itemId: invData.itemId,
        itemName: invData.item.name,
        itemRarity: invData.item.rarity,
        amount: 0,
        currency: 'spendable_points',
        previousBalance: 0,
        newBalance: 0,
        timestamp: new Date().toISOString(),
        source: 'exam_tool_usage',
        metadata: {
          examId,
          attemptId,
          toolType: itemEffect?.toolType,
          remainingQuantity: remaining,
        },
      };

      transaction.set(txDocRef, storeTx);
    });

    return {
      success: true,
      remainingQuantity: remaining,
      effect: itemEffect,
    };
  } catch (err: any) {
    console.error('[PointEconomyService] Consume exam item error:', err);
    return {
      success: false,
      error: err?.message || 'تعذر استخدام الأداة.',
    };
  }
}

/**
 * Award rewards (both Competition Points & Spendable Points) to a user for completing an exam, challenge, streak, etc.
 */
export async function awardRewardPoints(
  userId: string,
  spendable: number,
  competition: number,
  source: string,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    const userDocRef = doc(db, 'users', userId);
    const txDocRef = doc(collection(db, STORE_TRANSACTIONS_COLLECTION));

    await runTransaction(db, async (transaction) => {
      const userSnap = await transaction.get(userDocRef);
      if (!userSnap.exists()) return;
      const userData = userSnap.data() as UserProfile;

      const currentSpendable = typeof userData.spendablePoints === 'number' ? userData.spendablePoints : (userData.totalPoints || 0);
      const currentTotal = userData.totalPoints || 0;
      const currentWeekly = userData.weeklyPoints || 0;
      const currentMonthly = userData.monthlyPoints || 0;

      const newSpendable = currentSpendable + spendable;
      const newTotal = currentTotal + competition;
      const newWeekly = currentWeekly + competition;
      const newMonthly = currentMonthly + competition;

      transaction.update(userDocRef, {
        spendablePoints: newSpendable,
        totalPoints: newTotal,
        competitionPoints: newTotal,
        weeklyPoints: newWeekly,
        monthlyPoints: newMonthly,
        updatedAt: new Date().toISOString(),
      });

      if (spendable > 0 || competition > 0) {
        const storeTx: StoreTransaction = {
          id: txDocRef.id,
          userId,
          userDisplayName: userData.displayName || userData.username,
          type: 'reward',
          amount: spendable,
          currency: 'spendable_points',
          previousBalance: currentSpendable,
          newBalance: newSpendable,
          timestamp: new Date().toISOString(),
          source,
          metadata: {
            competitionPointsAwarded: competition,
            ...metadata,
          },
        };
        transaction.set(txDocRef, storeTx);
      }
    });
  } catch (err) {
    console.error('[PointEconomyService] Award points error:', err);
  }
}

/**
 * Fetch global economy settings
 */
export async function getEconomySettings(): Promise<EconomySettings> {
  try {
    const settingsRef = doc(db, ECONOMY_SETTINGS_COLLECTION, ECONOMY_SETTINGS_DOC_ID);
    const snap = await getDoc(settingsRef);
    if (snap.exists()) {
      return snap.data() as EconomySettings;
    }
    return DEFAULT_ECONOMY_SETTINGS;
  } catch {
    return DEFAULT_ECONOMY_SETTINGS;
  }
}

/**
 * Save updated economy settings (Admin only)
 */
export async function saveEconomySettings(
  settings: Partial<EconomySettings>, 
  adminEmail: string
): Promise<void> {
  const settingsRef = doc(db, ECONOMY_SETTINGS_COLLECTION, ECONOMY_SETTINGS_DOC_ID);
  await setDoc(settingsRef, {
    ...settings,
    updatedAt: new Date().toISOString(),
    updatedBy: adminEmail,
  }, { merge: true });
}

/**
 * Admin: Fetch all store transactions for audit ledger
 */
export async function getAdminStoreTransactions(limitCount = 100): Promise<StoreTransaction[]> {
  try {
    const txRef = collection(db, STORE_TRANSACTIONS_COLLECTION);
    const q = query(txRef, orderBy('timestamp', 'desc'), limit(limitCount));
    const snapshot = await getDocs(q);

    const transactions: StoreTransaction[] = [];
    snapshot.forEach((d) => {
      transactions.push(d.data() as StoreTransaction);
    });
    return transactions;
  } catch (err) {
    console.error('Error fetching admin transactions:', err);
    return [];
  }
}
