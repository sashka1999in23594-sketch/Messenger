/** Хуки секретных чатов: ключи устройства, расшифровка сообщений, отпечаток. */
import { useEffect, useState } from 'react';
import type { ChatSummary, EncryptedPayload } from '@omni/shared';
import { chatKey, decryptMessage, fetchDeviceKey, getIdentity, isE2ESupported } from '../../shared/crypto/e2e';

export type SecretState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'unsupported' }
  | { status: 'wrong-device' }
  | { status: 'error'; message: string }
  | { status: 'ready'; key: CryptoKey; myDeviceId: string; myPublicKey: string; peerPublicKey: string };

export function useSecretChat(chat: ChatSummary | undefined, myId: string): SecretState {
  const [state, setState] = useState<SecretState>({ status: 'none' });
  const secret = chat?.secret;
  const peerId = chat?.peer?.id;
  useEffect(() => {
    if (!chat || chat.type !== 'secret' || !secret) {
      setState({ status: 'none' });
      return;
    }
    if (!isE2ESupported()) {
      setState({ status: 'unsupported' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    (async () => {
      const me = await getIdentity();
      if (secret.devices[myId] !== me.deviceId) return setState({ status: 'wrong-device' });
      const peerDevice = peerId ? secret.devices[peerId] : undefined;
      if (!peerDevice) return setState({ status: 'error', message: 'Собеседник покинул чат' });
      const peerKey = await fetchDeviceKey(peerDevice);
      const key = await chatKey(chat.id, peerKey.publicKey);
      if (!cancelled) setState({ status: 'ready', key, myDeviceId: me.deviceId, myPublicKey: me.publicKey, peerPublicKey: peerKey.publicKey });
    })().catch((e: unknown) => !cancelled && setState({ status: 'error', message: e instanceof Error ? e.message : 'Ошибка шифрования' }));
    return () => {
      cancelled = true;
    };
  }, [chat?.id, chat?.type, secret, myId, peerId]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

/** Открытые тексты храним только в памяти вкладки (не в localStorage/IndexedDB). */
const plaintexts = new Map<string, string>();
export function rememberPlaintext(idOrClientId: string, text: string) {
  plaintexts.set(idOrClientId, text);
}

export function useDecrypted(
  chatId: string,
  messageId: string,
  clientId: string | null,
  enc: EncryptedPayload | null,
  state: SecretState,
): { text: string | null; error: boolean } {
  const cached = plaintexts.get(messageId) ?? (clientId ? plaintexts.get(clientId) : undefined);
  const [result, setResult] = useState<{ text: string | null; error: boolean }>({ text: cached ?? null, error: false });
  useEffect(() => {
    if (cached !== undefined) {
      setResult({ text: cached, error: false });
      return;
    }
    if (!enc || state.status !== 'ready') return;
    let cancelled = false;
    decryptMessage(chatId, state.key, enc)
      .then((p) => {
        plaintexts.set(messageId, p.text);
        if (!cancelled) setResult({ text: p.text, error: false });
      })
      .catch(() => !cancelled && setResult({ text: null, error: true }));
    return () => {
      cancelled = true;
    };
  }, [chatId, messageId, enc?.ciphertext, state.status, cached]); // eslint-disable-line react-hooks/exhaustive-deps
  return result;
}
