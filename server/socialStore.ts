import fs from 'fs';
import path from 'path';

export interface SocialStoreData {
  friendships: Record<string, any>;
  conversations: Record<string, any>;
  messages: Record<string, any[]>;
  blocks: Record<string, any>;
  users: Record<string, any>;
}

const STORAGE_FILE = path.join(process.cwd(), 'data', 'social_storage.json');

function ensureFile(): SocialStoreData {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(STORAGE_FILE)) {
      const initial: SocialStoreData = {
        friendships: {},
        conversations: {},
        messages: {},
        blocks: {},
        users: {},
      };
      fs.writeFileSync(STORAGE_FILE, JSON.stringify(initial, null, 2), 'utf-8');
      return initial;
    }
    const content = fs.readFileSync(STORAGE_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {
      friendships: {},
      conversations: {},
      messages: {},
      blocks: {},
      users: {},
    };
  }
}

function saveData(data: SocialStoreData) {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[SocialStore] Error saving data file:', err);
  }
}

const storeCache: SocialStoreData = ensureFile();

export function saveUserToStore(user: any) {
  if (!user?.uid) return;
  storeCache.users[user.uid] = {
    ...storeCache.users[user.uid],
    ...user,
  };
  saveData(storeCache);
}

export function saveFriendship(sender: any, receiver: any, action?: string) {
  if (sender) saveUserToStore(sender);
  if (receiver) saveUserToStore(receiver);

  const [first, second] = [sender.uid, receiver.uid].sort();
  const id = `friend_${first}_${second}`;

  if (action === 'remove') {
    delete storeCache.friendships[id];
    saveData(storeCache);
    return { success: true, action: 'remove' };
  }

  const now = new Date().toISOString();
  const friendship = {
    id,
    user1Id: sender.uid,
    user2Id: receiver.uid,
    users: [sender.uid, receiver.uid],
    senderId: sender.uid,
    receiverId: receiver.uid,
    status: 'accepted',
    createdAt: now,
    updatedAt: now,
  };

  storeCache.friendships[id] = friendship;
  saveData(storeCache);
  return { success: true, friendship };
}

export function getFriendsForUser(userId: string): any[] {
  const matchingFriendships = Object.values(storeCache.friendships).filter(
    (f: any) => f.status === 'accepted' && Array.isArray(f.users) && f.users.includes(userId)
  );

  const friends: any[] = [];
  for (const f of matchingFriendships) {
    const otherId = f.users.find((id: string) => id !== userId);
    if (otherId) {
      const u = storeCache.users[otherId] || {
        uid: otherId,
        displayName: 'طالب في المنصة',
        username: 'student',
        role: 'student',
        totalPoints: 0,
      };
      friends.push(u);
    }
  }
  return friends;
}

export function getOrCreateConv(user1: any, user2: any): any {
  if (user1) saveUserToStore(user1);
  if (user2) saveUserToStore(user2);

  const [first, second] = [user1.uid, user2.uid].sort();
  const convId = `conv_${first}_${second}`;

  if (storeCache.conversations[convId]) {
    return storeCache.conversations[convId];
  }

  const now = new Date().toISOString();
  const conv = {
    id: convId,
    participants: [user1.uid, user2.uid],
    participantData: {
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
    },
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

  storeCache.conversations[convId] = conv;
  saveData(storeCache);
  return conv;
}

export function saveMessage(params: {
  conversationId: string;
  sender: any;
  recipientId: string;
  text: string;
}): any {
  const { conversationId, sender, recipientId, text } = params;
  if (sender) saveUserToStore(sender);

  const now = new Date().toISOString();
  const msgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const message = {
    id: msgId,
    conversationId,
    senderId: sender.uid,
    senderName: sender.displayName || sender.username,
    senderPhotoURL: sender.photoURL || '',
    text,
    createdAt: now,
    readBy: [sender.uid],
  };

  if (!storeCache.messages[conversationId]) {
    storeCache.messages[conversationId] = [];
  }
  storeCache.messages[conversationId].push(message);

  if (storeCache.conversations[conversationId]) {
    storeCache.conversations[conversationId].lastMessageText = text;
    storeCache.conversations[conversationId].lastMessageSenderId = sender.uid;
    storeCache.conversations[conversationId].lastMessageTimestamp = now;
    storeCache.conversations[conversationId].updatedAt = now;
    if (!storeCache.conversations[conversationId].unreadCount) {
      storeCache.conversations[conversationId].unreadCount = {};
    }
    storeCache.conversations[conversationId].unreadCount[recipientId] = 
      (storeCache.conversations[conversationId].unreadCount[recipientId] || 0) + 1;
  }

  saveData(storeCache);
  return message;
}

export function getMessagesForConv(conversationId: string): any[] {
  return storeCache.messages[conversationId] || [];
}

export function saveBlock(currentUserId: string, targetUserId: string, action?: string) {
  const id = `block_${currentUserId}_${targetUserId}`;
  if (action === 'unblock') {
    delete storeCache.blocks[id];
  } else {
    storeCache.blocks[id] = {
      blockerId: currentUserId,
      blockedId: targetUserId,
      createdAt: new Date().toISOString(),
    };
  }
  saveData(storeCache);
}

export function getBlockStatus(currentUserId: string, targetUserId: string) {
  const blockedByMe = !!storeCache.blocks[`block_${currentUserId}_${targetUserId}`];
  const blockedByOther = !!storeCache.blocks[`block_${targetUserId}_${currentUserId}`];
  return {
    isBlocked: blockedByMe || blockedByOther,
    blockedByMe,
    blockedByOther,
    myBlockId: blockedByMe ? `block_${currentUserId}_${targetUserId}` : undefined,
  };
}
