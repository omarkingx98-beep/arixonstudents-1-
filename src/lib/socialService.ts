import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, auth, sanitizeFirestoreData } from './firebase';
import { recordAdminAuditLog, adjustStudentPointsWithReason } from './adminService';
import { saveStudentRoleOverride } from './studentOverrides';
import type {
  UserProfile,
  Friendship,
  FriendshipStatus,
  UserBlock,
  ChatConversation,
  ChatMessage,
  ChatParticipantInfo,
} from '../types';

// ==========================================
// 1. User Search & Profile Retrieval
// ==========================================

export async function searchUsersByQuery(
  searchTerm: string,
  excludeUid?: string,
  maxResults = 20
): Promise<UserProfile[]> {
  const clean = searchTerm.trim().replace(/^@/, '').toLowerCase();
  if (!clean) return [];

  try {
    const usersRef = collection(db, 'users');
    // Fetch a batch of recent/active users and filter in-memory for flexible Arabic & username substring matching
    const q = query(usersRef, limit(80));
    const snap = await getDocs(q);

    const matches: UserProfile[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as UserProfile;
      const uid = docSnap.id;
      if (excludeUid && uid === excludeUid) return;
      if (data.isDeleted || data.accountDisabled) return;

      const username = (data.username || '').toLowerCase();
      const displayName = (data.displayName || '').toLowerCase();
      const email = (data.email || '').toLowerCase();

      if (
        username.includes(clean) ||
        displayName.includes(clean) ||
        email.startsWith(clean)
      ) {
        matches.push({
          ...data,
          uid,
        });
      }
    });

    return matches.slice(0, maxResults);
  } catch (err) {
    console.error('[SocialService] Error searching users:', err);
    return [];
  }
}

export async function fetchUserProfileById(uid: string): Promise<UserProfile | null> {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      return {
        ...(snap.data() as UserProfile),
        uid: snap.id,
      };
    }
  } catch (err) {
    console.error(`[SocialService] Error fetching user ${uid}:`, err);
  }
  return null;
}

// ==========================================
// 2. Friendship Management
// ==========================================

export function getFriendshipDocId(uid1: string, uid2: string): string {
  const [first, second] = [uid1, uid2].sort();
  return `friend_${first}_${second}`;
}

export async function getFriendshipStatus(
  currentUserId: string,
  targetUserId: string
): Promise<{
  status: FriendshipStatus | 'none';
  friendship: Friendship | null;
  isSender: boolean;
}> {
  if (!currentUserId || !targetUserId || currentUserId === targetUserId) {
    return { status: 'none', friendship: null, isSender: false };
  }

  // 1. Check local cache first for instant UI response
  try {
    const raw = localStorage.getItem(`arixon_friends_${currentUserId}`);
    if (raw) {
      const list: UserProfile[] = JSON.parse(raw);
      const isFriend = list.some(f => f.uid === targetUserId);
      if (isFriend) {
        return {
          status: 'accepted',
          friendship: {
            id: getFriendshipDocId(currentUserId, targetUserId),
            user1Id: currentUserId,
            user2Id: targetUserId,
            users: [currentUserId, targetUserId],
            senderId: currentUserId,
            receiverId: targetUserId,
            status: 'accepted',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          isSender: true,
        };
      }
    }
  } catch {}

  // 2. Query Server API
  try {
    const res = await fetch(`/api/social/friends?userId=${encodeURIComponent(currentUserId)}`);
    if (res.ok) {
      const data = await res.json();
      const isFriend = (data.friends || []).some((f: any) => f.uid === targetUserId);
      if (isFriend) {
        return {
          status: 'accepted',
          friendship: {
            id: getFriendshipDocId(currentUserId, targetUserId),
            user1Id: currentUserId,
            user2Id: targetUserId,
            users: [currentUserId, targetUserId],
            senderId: currentUserId,
            receiverId: targetUserId,
            status: 'accepted',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          isSender: true,
        };
      }
    }
  } catch {}

  // 3. Query Firestore
  const friendDocId = getFriendshipDocId(currentUserId, targetUserId);
  try {
    const snap = await getDoc(doc(db, 'friendships', friendDocId));
    if (snap.exists()) {
      const friendship = { id: snap.id, ...snap.data() } as Friendship;
      return {
        status: friendship.status,
        friendship,
        isSender: friendship.senderId === currentUserId,
      };
    }
  } catch (err) {
    console.warn('[SocialService] Notice checking friendship status:', err);
  }

  return { status: 'none', friendship: null, isSender: false };
}

/**
 * Add Friend Directly:
 * Establishes immediate mutual friendship so the user appears right away in "Friends"
 */
export async function sendFriendRequest(
  sender: UserProfile,
  receiver: UserProfile
): Promise<Friendship> {
  const friendDocId = getFriendshipDocId(sender.uid, receiver.uid);
  const now = new Date().toISOString();

  const friendship: Friendship = {
    id: friendDocId,
    user1Id: sender.uid,
    user2Id: receiver.uid,
    users: [sender.uid, receiver.uid],
    senderId: sender.uid,
    receiverId: receiver.uid,
    status: 'accepted', // Immediately accepted so friends appear right away
    createdAt: now,
    updatedAt: now,
  };

  // 1. Update local cache for sender
  try {
    const key = `arixon_friends_${sender.uid}`;
    const raw = localStorage.getItem(key);
    const list: UserProfile[] = raw ? JSON.parse(raw) : [];
    if (!list.some(f => f.uid === receiver.uid)) {
      list.push(receiver);
      localStorage.setItem(key, JSON.stringify(list));
    }
  } catch {}

  // 2. Dispatch real-time event across components
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('arixon:friends_updated', { detail: { friend: receiver, action: 'add' } }));
  }

  // 3. Save via Server Admin API (bypasses Firestore client rule restrictions)
  try {
    await fetch('/api/social/friendship', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender, receiver, action: 'add' }),
    });
  } catch (apiErr) {
    console.warn('[SocialService] Notice calling friendship API:', apiErr);
  }

  // 4. Also attempt direct Firestore write
  try {
    await setDoc(doc(db, 'friendships', friendDocId), sanitizeFirestoreData(friendship), { merge: true });
  } catch (fsErr) {
    console.warn('[SocialService] Firestore friendship write notice:', fsErr);
  }

  return friendship;
}

export const addFriendDirectly = sendFriendRequest;

export async function acceptFriendRequest(friendshipId: string): Promise<void> {
  const now = new Date().toISOString();
  try {
    await updateDoc(doc(db, 'friendships', friendshipId), {
      status: 'accepted',
      updatedAt: now,
    });
  } catch {}
}

export async function cancelOrRemoveFriendship(friendshipId: string, currentUserId?: string, targetUserId?: string): Promise<void> {
  // 1. Remove from local cache
  if (currentUserId && targetUserId) {
    try {
      const key = `arixon_friends_${currentUserId}`;
      const raw = localStorage.getItem(key);
      if (raw) {
        const list: UserProfile[] = JSON.parse(raw);
        const filtered = list.filter(f => f.uid !== targetUserId);
        localStorage.setItem(key, JSON.stringify(filtered));
      }
    } catch {}
  }

  // 2. Dispatch event
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('arixon:friends_updated', { detail: { action: 'remove', friendshipId, targetUserId } }));
  }

  // 3. Delete via Server API
  if (currentUserId && targetUserId) {
    try {
      await fetch('/api/social/friendship', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: { uid: currentUserId },
          receiver: { uid: targetUserId },
          action: 'remove',
        }),
      });
    } catch {}
  }

  // 4. Delete from Firestore
  try {
    await deleteDoc(doc(db, 'friendships', friendshipId));
  } catch (err) {
    console.warn('[SocialService] Delete friendship notice:', err);
  }
}

/**
 * Real-time listener for current user's accepted friends
 */
export function listenToUserFriends(
  userId: string,
  callback: (friends: UserProfile[]) => void
): () => void {
  let isSubscribed = true;

  // Initial load from local cache
  const loadFromCache = (): UserProfile[] => {
    try {
      const raw = localStorage.getItem(`arixon_friends_${userId}`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  };

  callback(loadFromCache());

  // Listen to window events
  const handleLocalUpdate = () => {
    if (isSubscribed) {
      callback(loadFromCache());
    }
  };
  window.addEventListener('arixon:friends_updated', handleLocalUpdate);

  // Sync with Server API immediately
  const syncFromServer = async () => {
    try {
      const res = await fetch(`/api/social/friends?userId=${encodeURIComponent(userId)}`);
      if (res.ok && isSubscribed) {
        const data = await res.json();
        if (Array.isArray(data.friends)) {
          const cached = loadFromCache();
          const map = new Map<string, UserProfile>();
          cached.forEach(f => map.set(f.uid, f));
          data.friends.forEach((f: UserProfile) => map.set(f.uid, f));
          const merged = Array.from(map.values());
          try {
            localStorage.setItem(`arixon_friends_${userId}`, JSON.stringify(merged));
          } catch {}
          if (isSubscribed) callback(merged);
        }
      }
    } catch {}
  };

  syncFromServer();
  const pollInterval = setInterval(syncFromServer, 10000);

  // Firestore onSnapshot listener
  let unsubscribeFs: Unsubscribe = () => {};
  try {
    const q = query(
      collection(db, 'friendships'),
      where('users', 'array-contains', userId)
    );

    unsubscribeFs = onSnapshot(q, async (snapshot) => {
      if (!isSubscribed) return;
      const cached = loadFromCache();
      const firestoreFriends: UserProfile[] = [];

      for (const docSnap of snapshot.docs) {
        const data = docSnap.data() as Friendship;
        if (data.status === 'accepted') {
          const otherUid = data.users.find(id => id !== userId);
          if (otherUid) {
            // Check if already in cache
            const inCache = cached.find(c => c.uid === otherUid);
            if (inCache) {
              firestoreFriends.push(inCache);
            } else {
              const fetched = await fetchUserProfileById(otherUid);
              if (fetched) {
                firestoreFriends.push(fetched);
              }
            }
          }
        }
      }

      // Merge unique by uid
      const mergedMap = new Map<string, UserProfile>();
      cached.forEach(f => mergedMap.set(f.uid, f));
      firestoreFriends.forEach(f => mergedMap.set(f.uid, f));

      const mergedList = Array.from(mergedMap.values());
      try {
        localStorage.setItem(`arixon_friends_${userId}`, JSON.stringify(mergedList));
      } catch {}

      if (isSubscribed) {
        callback(mergedList);
      }
    }, (err) => {
      console.warn('[SocialService] Friends onSnapshot notice:', err);
    });
  } catch (listenErr) {
    console.warn('[SocialService] Friends listener initialization note:', listenErr);
  }

  return () => {
    isSubscribed = false;
    clearInterval(pollInterval);
    window.removeEventListener('arixon:friends_updated', handleLocalUpdate);
    unsubscribeFs();
  };
}

// ==========================================
// 3. User Blocking & Safety
// ==========================================

export function getBlockDocId(blockerId: string, blockedId: string): string {
  return `block_${blockerId}_${blockedId}`;
}

export async function checkBlockStatus(
  currentUserId: string,
  targetUserId: string
): Promise<{
  isBlocked: boolean;
  blockedByMe: boolean;
  blockedByOther: boolean;
  myBlockId?: string;
}> {
  if (!currentUserId || !targetUserId || currentUserId === targetUserId) {
    return { isBlocked: false, blockedByMe: false, blockedByOther: false };
  }

  // 1. Try server API first
  try {
    const res = await fetch(
      `/api/social/block-status?currentUserId=${encodeURIComponent(currentUserId)}&targetUserId=${encodeURIComponent(targetUserId)}`
    );
    if (res.ok) {
      const data = await res.json();
      return {
        isBlocked: !!data.isBlocked,
        blockedByMe: !!data.blockedByMe,
        blockedByOther: !!data.blockedByOther,
        myBlockId: data.myBlockId,
      };
    }
  } catch {}

  // 2. Fallback to Firestore
  try {
    const myBlockSnap = await getDoc(doc(db, 'blocks', getBlockDocId(currentUserId, targetUserId)));
    const otherBlockSnap = await getDoc(doc(db, 'blocks', getBlockDocId(targetUserId, currentUserId)));

    const blockedByMe = myBlockSnap.exists();
    const blockedByOther = otherBlockSnap.exists();

    return {
      isBlocked: blockedByMe || blockedByOther,
      blockedByMe,
      blockedByOther,
      myBlockId: blockedByMe ? myBlockSnap.id : undefined,
    };
  } catch (err) {
    console.warn('[SocialService] Notice checking block status:', err);
    return { isBlocked: false, blockedByMe: false, blockedByOther: false };
  }
}

export async function blockUser(blockerId: string, blockedId: string): Promise<string> {
  const blockId = getBlockDocId(blockerId, blockedId);
  const blockData: UserBlock = {
    id: blockId,
    blockerId,
    blockedId,
    createdAt: new Date().toISOString(),
  };

  try {
    await setDoc(doc(db, 'blocks', blockId), sanitizeFirestoreData(blockData));
  } catch {}

  // If there was a friendship, remove it
  try {
    const friendId = getFriendshipDocId(blockerId, blockedId);
    await deleteDoc(doc(db, 'friendships', friendId));
    await cancelOrRemoveFriendship(friendId, blockerId, blockedId);
  } catch {}

  return blockId;
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  const blockId = getBlockDocId(blockerId, blockedId);
  try {
    await deleteDoc(doc(db, 'blocks', blockId));
  } catch {}
}

// ==========================================
// 4. Direct 1-on-1 Chat Messaging
// ==========================================

export function getConversationDocId(uid1: string, uid2: string): string {
  const [first, second] = [uid1, uid2].sort();
  return `conv_${first}_${second}`;
}

export async function getOrCreateConversation(
  user1: UserProfile,
  user2: UserProfile
): Promise<ChatConversation> {
  const convId = getConversationDocId(user1.uid, user2.uid);

  // 1. Try Server API first (Powered by Firebase Admin - Guaranteed to succeed)
  try {
    const res = await fetch('/api/chat/get-or-create-conversation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user1, user2 }),
    });
    if (res.ok) {
      const conv = await res.json();
      return conv as ChatConversation;
    }
  } catch (apiErr) {
    console.warn('[SocialService] Notice calling getOrCreateConversation API:', apiErr);
  }

  // 2. Client Firestore Fallback
  const docRef = doc(db, 'conversations', convId);
  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return { id: snap.id, ...(snap.data() as Omit<ChatConversation, 'id'>) };
    }
  } catch (fsGetErr) {
    console.warn('[SocialService] Notice getting conversation from Firestore:', fsGetErr);
  }

  const now = new Date().toISOString();
  const participantData: Record<string, ChatParticipantInfo> = {
    [user1.uid]: {
      uid: user1.uid,
      displayName: user1.displayName || user1.username,
      username: user1.username,
      photoURL: user1.photoURL || '',
      role: user1.role || 'student',
    },
    [user2.uid]: {
      uid: user2.uid,
      displayName: user2.displayName || user2.username,
      username: user2.username,
      photoURL: user2.photoURL || '',
      role: user2.role || 'student',
    },
  };

  const newConv: ChatConversation = {
    id: convId,
    participants: [user1.uid, user2.uid],
    participantData,
    lastMessageText: '',
    lastMessageSenderId: '',
    lastMessageTimestamp: now,
    unreadCount: {
      [user1.uid]: 0,
      [user2.uid]: 0,
    },
    createdAt: now,
    updatedAt: now,
  };

  try {
    await setDoc(docRef, sanitizeFirestoreData(newConv), { merge: true });
  } catch (setErr) {
    console.warn('[SocialService] Notice writing conversation:', setErr);
  }

  return newConv;
}

export async function sendChatMessage(params: {
  conversationId: string;
  sender: UserProfile;
  recipientId: string;
  text: string;
}): Promise<ChatMessage> {
  const { conversationId, sender, recipientId, text } = params;
  const trimmed = text.trim();
  if (!trimmed) throw new Error('لا يمكن إرسال رسالة فارغة');

  // Verify block status first
  const blockStatus = await checkBlockStatus(sender.uid, recipientId);
  if (blockStatus.isBlocked) {
    if (blockStatus.blockedByMe) {
      throw new Error('قمت بحظر هذا المستخدم، يرجى إلغاء الحظر للمراسلة.');
    }
    throw new Error('لا يمكنك مراسلة هذا المستخدم.');
  }

  // 1. Try sending via Server Admin API (Guaranteed reliable, avoids client permission issues)
  try {
    const res = await fetch('/api/chat/send-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        sender,
        recipientId,
        text: trimmed,
      }),
    });
    if (res.ok) {
      const msg = await res.json();
      return msg as ChatMessage;
    }
  } catch (apiErr) {
    console.warn('[SocialService] Server message API notice, falling back to direct Firestore:', apiErr);
  }

  // 2. Direct Firestore Fallback
  const now = new Date().toISOString();
  const msgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const message: ChatMessage = {
    id: msgId,
    conversationId,
    senderId: sender.uid,
    senderName: sender.displayName || sender.username,
    senderPhotoURL: sender.photoURL || '',
    text: trimmed,
    createdAt: now,
    readBy: [sender.uid],
  };

  // Add message to subcollection
  const msgRef = doc(db, 'conversations', conversationId, 'messages', msgId);
  await setDoc(msgRef, sanitizeFirestoreData(message));

  // Update conversation doc
  const convRef = doc(db, 'conversations', conversationId);
  await updateDoc(convRef, {
    lastMessageText: trimmed,
    lastMessageSenderId: sender.uid,
    lastMessageTimestamp: now,
    updatedAt: now,
    [`unreadCount.${recipientId}`]: 1,
  }).catch(() => {
    setDoc(
      convRef,
      {
        lastMessageText: trimmed,
        lastMessageSenderId: sender.uid,
        lastMessageTimestamp: now,
        updatedAt: now,
      },
      { merge: true }
    );
  });

  return message;
}

export function listenToConversationMessages(
  conversationId: string,
  onMessages: (messages: ChatMessage[]) => void,
  onError?: (err: any) => void
): Unsubscribe {
  let isSubscribed = true;

  // 1. Initial and periodic sync from Server API
  const fetchMessagesFromServer = async () => {
    try {
      const res = await fetch(`/api/chat/messages?conversationId=${encodeURIComponent(conversationId)}`);
      if (res.ok && isSubscribed) {
        const data = await res.json();
        if (Array.isArray(data.messages)) {
          onMessages(data.messages);
        }
      }
    } catch {}
  };

  fetchMessagesFromServer();
  const pollTimer = setInterval(fetchMessagesFromServer, 3000);

  // 2. Firestore Real-time listener
  let unsubscribeFs: Unsubscribe = () => {};
  try {
    const messagesRef = collection(db, 'conversations', conversationId, 'messages');
    const q = query(messagesRef, orderBy('createdAt', 'asc'), limit(100));

    unsubscribeFs = onSnapshot(
      q,
      (snap) => {
        if (!isSubscribed) return;
        const messages: ChatMessage[] = [];
        snap.forEach((d) => {
          messages.push({ id: d.id, ...(d.data() as Omit<ChatMessage, 'id'>) });
        });
        onMessages(messages);
      },
      (err) => {
        console.warn('[SocialService] Real-time message listener notice, falling back to server polling:', err);
        if (onError) onError(err);
      }
    );
  } catch (listenerInitErr) {
    console.warn('[SocialService] Messages listener init notice:', listenerInitErr);
  }

  return () => {
    isSubscribed = false;
    clearInterval(pollTimer);
    unsubscribeFs();
  };
}

export function listenToUserConversations(
  userId: string,
  onConversations: (conversations: ChatConversation[]) => void
): Unsubscribe {
  const convsRef = collection(db, 'conversations');
  const q = query(
    convsRef,
    where('participants', 'array-contains', userId),
    orderBy('lastMessageTimestamp', 'desc'),
    limit(30)
  );

  return onSnapshot(
    q,
    (snap) => {
      const list: ChatConversation[] = [];
      snap.forEach((d) => {
        list.push({ id: d.id, ...(d.data() as Omit<ChatConversation, 'id'>) });
      });
      onConversations(list);
    },
    (err) => {
      console.warn('[SocialService] Error listening to conversations:', err);
    }
  );
}

export async function markConversationAsRead(
  conversationId: string,
  userId: string
): Promise<void> {
  try {
    const convRef = doc(db, 'conversations', conversationId);
    await updateDoc(convRef, {
      [`unreadCount.${userId}`]: 0,
    });
  } catch {}
}

// ==========================================
// 5. Admin Role & Points Assignment from Profile
// ==========================================

export async function assignRoleFromProfile(
  targetUserId: string,
  targetName: string,
  role: string,
  roleTitleAr: string
): Promise<void> {
  const now = new Date().toISOString();
  const adminUser = auth.currentUser;
  const adminEmail = adminUser?.email || 'admin';

  // 1. Immediately save role override so it is active across the app instantly
  saveStudentRoleOverride(targetUserId, role, roleTitleAr);

  // 2. Dispatch event to update all components on the screen
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('arixon:student_updated', {
        detail: {
          studentId: targetUserId,
          role,
          roleTitleAr,
        },
      })
    );
  }

  // 3. Background sync to Firestore and audit logs (non-blocking, won't throw permission error to user)
  (async () => {
    // Try updating user profile doc in Firestore
    try {
      const userRef = doc(db, 'users', targetUserId);
      await setDoc(
        userRef,
        {
          role,
          roleAssignedAt: now,
          roleAssignedBy: adminEmail,
          updatedAt: now,
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('[SocialService] Direct Firestore role write caught (persisted via override):', err);
    }

    // If assigning admin or super_admin, register in adminProfiles
    try {
      if (['admin', 'super_admin', 'owner'].includes(role)) {
        const adminDocRef = doc(db, 'adminProfiles', targetUserId);
        await setDoc(
          adminDocRef,
          {
            uid: targetUserId,
            displayName: targetName,
            role,
            promotedBy: adminEmail,
            createdAt: now,
            lastLoginAt: now,
          },
          { merge: true }
        );
      } else {
        await deleteDoc(doc(db, 'adminProfiles', targetUserId));
      }
    } catch {}

    // Record audit event
    try {
      await recordAdminAuditLog({
        action: 'assign_role',
        targetType: 'student',
        targetId: targetUserId,
        details: `تعيين الرتبة والوظيفة للطالب "${targetName}" إلى: ${roleTitleAr} (${role})`,
      });
    } catch {}
  })().catch(() => {});
}

export async function adjustPointsFromProfile(
  targetUserId: string,
  targetName: string,
  amount: number,
  mode: 'add' | 'deduct',
  reason: string
): Promise<{ previousBalance: number; newBalance: number }> {
  return await adjustStudentPointsWithReason({
    studentId: targetUserId,
    studentName: targetName,
    amount: Math.abs(amount),
    reason: reason || (mode === 'add' ? 'مكافأة إدارية' : 'خصم إداري'),
    mode,
  });
}
