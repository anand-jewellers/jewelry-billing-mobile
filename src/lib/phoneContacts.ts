// src/lib/phoneContacts.ts
import { Platform, Alert, Linking } from 'react-native';
import type { Customer } from '../types/invoices';

let cache: Customer[] | null = null;
let loading: Promise<Customer[]> | null = null;
let askedSettings = false;
let shownError = false;

const last10 = (s: string) => s.replace(/\D/g, '').slice(-10);

// Newer expo-contacts: the function API (getContactsAsync, ...) lives in
// 'expo-contacts/legacy'. Older versions export it from the package root.
function getContactsModule(): any {
    let mod: any = null;
    try {
        mod = require('expo-contacts/legacy');
    } catch {
        mod = null;
    }
    if (!mod || typeof mod.getContactsAsync !== 'function') {
        mod = require('expo-contacts');
    }
    if (typeof mod.getContactsAsync !== 'function' && mod.default) {
        mod = mod.default;
    }
    if (typeof mod.getContactsAsync !== 'function') {
        throw new Error('expo-contacts function API not found (getContactsAsync missing)');
    }
    return mod;
}

// Reads the phone book once (only successful loads are cached)
async function loadPhoneContacts(): Promise<Customer[]> {
    if (Platform.OS === 'web') return [];
    if (cache) return cache;
    if (loading) return loading;

    loading = (async () => {
        try {
            const Contacts = getContactsModule();

            let perm = await Contacts.getPermissionsAsync();
            if (perm.status !== 'granted' && perm.canAskAgain !== false) {
                perm = await Contacts.requestPermissionsAsync();
            }
            console.log('[phoneContacts] permission:', perm.status, '| canAskAgain:', perm.canAskAgain);

            if (perm.status !== 'granted') {
                if (perm.canAskAgain === false && !askedSettings) {
                    askedSettings = true;
                    Alert.alert(
                        'Contacts permission needed',
                        'Allow Contacts access in Settings to fetch names and numbers from your phone.',
                        [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Open Settings', onPress: () => Linking.openSettings() },
                        ]
                    );
                }
                return [];
            }

            const res = await Contacts.getContactsAsync({
                fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
            });
            const data = res?.data ?? [];
            console.log('[phoneContacts] contacts read:', data.length);

            const byNumber = new Map<string, Customer>();
            for (const c of data) {
                const name = c.name || [c.firstName, c.lastName].filter(Boolean).join(' ');
                if (!name) continue;
                for (const p of c.phoneNumbers ?? []) {
                    const num = last10(p.number ?? p.digits ?? '');
                    // keep only the first contact for each number
                    if (num.length === 10 && !byNumber.has(num)) {
                        byNumber.set(num, { id: `contact-${c.id}-${num}`, name, phone: num, email: null });
                    }
                }
            }
            const list = Array.from(byNumber.values());
            console.log('[phoneContacts] usable numbers:', list.length);
            cache = list;
            return list;
            
        } catch (e: any) {
            const msg = e?.message ?? String(e);
            console.warn('[phoneContacts] failed:', msg);
            // Temporary: show the reason on screen once so Metro isn't needed
            if (!shownError) {
                shownError = true;
                Alert.alert('Contacts error', msg);
            }
            return [];
        } finally {
            loading = null;
        }
    })();

    return loading;
}

export async function searchPhoneContacts(
    query: string,
    mode: 'name' | 'phone',
    limit = 5
): Promise<Customer[]> {
    const all = await loadPhoneContacts();
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');

    const out = all
        .filter((c) =>
            mode === 'phone' ? digits.length >= 3 && c.phone!.includes(digits) : c.name.toLowerCase().includes(q)
        )
        .slice(0, limit);

    console.log('[phoneContacts] search', mode, JSON.stringify(q), '->', out.length);
    return out;
}