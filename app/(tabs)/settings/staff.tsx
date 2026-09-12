// app/(tabs)/settings/staff.tsx
import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, TextInput, Switch, Alert, Modal } from 'react-native';
import { Plus, X, KeyRound, UserX, UserCheck } from 'lucide-react-native';
import { Card } from '../../../src/components/ui';
import { colors, spacing } from '../../../src/theme';
import { supabase } from '../../../src/lib/supabaseClient';
import { PAGE_REGISTRY, type PageKey } from '../../../src/types/settings';
import type { Staff, StaffRole } from '../../../src/types/settings';
import { useStaff } from '../../../src/context/StaffContext';
import { PageGuard } from '../../../src/components/PageGuard';

type PermMap = Record<string, boolean>;
type StaffWithPerms = Staff & { permissions: PermMap };

// Admin is seeded directly in the database once and is never created or
// re-assigned from this screen. Only these roles are pickable here.
const CREATABLE_ROLES: StaffRole[] = ['staff', 'manager'];

export default function StaffSettingsScreen() {
  return (
    <PageGuard pageKey="settings.staff">
      <StaffSettingsScreenInner />
    </PageGuard>
  );
}

function StaffSettingsScreenInner() {
  const { refreshStaffList } = useStaff();
  const [rows, setRows] = useState<StaffWithPerms[]>([]);
  const [editing, setEditing] = useState<StaffWithPerms | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('list_staff_with_permissions');
    if (!error && data) {
      setRows(
        data.map((r: any) => ({
          ...r,
          permissions: Object.fromEntries((r.permissions ?? []).map((p: any) => [p.page_key, p.can_access])),
        }))
      );
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = async (s: Staff) => {
    await supabase.from('staff').update({ is_active: !s.is_active }).eq('id', s.id);
    await load();
    await refreshStaffList();
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.lg }}>
      <Pressable style={styles.addBtn} onPress={() => setShowAdd(true)}>
        <Plus size={18} color={colors.background} />
        <Text style={styles.addBtnText}>Add staff</Text>
      </Pressable>

      {rows.map((s) => (
        <Card key={s.id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>
              {s.name} {!s.is_active && <Text style={styles.inactiveTag}>(inactive)</Text>}
            </Text>
            <Text style={styles.meta}>
              {s.role} · {s.email ?? s.phone ?? '—'}
            </Text>
          </View>
          {s.role !== 'admin' && (
            <>
              <Pressable style={styles.iconBtn} onPress={() => setEditing(s)}>
                <KeyRound size={18} color={colors.textSecondary} />
              </Pressable>
              <Pressable style={styles.iconBtn} onPress={() => toggleActive(s)}>
                {s.is_active ? <UserX size={18} color="crimson" /> : <UserCheck size={18} color="green" />}
              </Pressable>
            </>
          )}
        </Card>
      ))}

      {(showAdd || editing) && (
        <StaffEditorModal
          staff={editing}
          onClose={() => {
            setShowAdd(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setShowAdd(false);
            setEditing(null);
            await load();
            await refreshStaffList();
          }}
        />
      )}
    </ScrollView>
  );
}

function StaffEditorModal({
  staff,
  onClose,
  onSaved,
}: {
  staff: StaffWithPerms | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !staff;
  const [name, setName] = useState(staff?.name ?? '');
  const [phone, setPhone] = useState(staff?.phone ?? '');
  const [email, setEmail] = useState(staff?.email ?? '');
  // Never default into 'admin', even if this modal is somehow opened on an admin row.
  const [role, setRole] = useState<StaffRole>(staff?.role === 'admin' ? 'manager' : staff?.role ?? 'staff');
  const [password, setPassword] = useState('');
  const [perms, setPerms] = useState<PermMap>(staff?.permissions ?? {});
  const [saving, setSaving] = useState(false);

  const togglePerm = (key: PageKey) => setPerms((p) => ({ ...p, [key]: !p[key] }));

  const save = async () => {
    if (!name.trim()) return Alert.alert('Name is required');
    if (!email.trim()) return Alert.alert('Email is required');
    if (isNew && password.length < 6) return Alert.alert('Password must be at least 6 characters');

    setSaving(true);
    try {
      let staffId = staff?.id;

      if (isNew) {
        const { data, error } = await supabase.rpc('create_staff_with_password', {
          p_name: name,
          p_phone: phone || null,
          p_email: email,
          p_role: role,
          p_password: password,
        });
        if (error) throw error;
        staffId = data as string;
      } else {
        const { error } = await supabase
          .from('staff')
          .update({ name, phone: phone || null, email, role })
          .eq('id', staffId);
        if (error) throw error;

        if (password) {
          const { error: pwErr } = await supabase.rpc('set_staff_password', {
            p_staff_id: staffId,
            p_password: password,
          });
          if (pwErr) throw pwErr;
        }
      }

      if (role === 'staff' && staffId) {
        const payload = PAGE_REGISTRY.map((p) => ({ page_key: p.key, can_access: !!perms[p.key] }));
        const { error: permErr } = await supabase.rpc('set_staff_permissions', {
          p_staff_id: staffId,
          p_permissions: payload,
        });
        if (permErr) throw permErr;
      }

      onSaved();
    } catch (e: any) {
      Alert.alert('Could not save', e.message ?? 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const groups = Array.from(new Set(PAGE_REGISTRY.map((p) => p.group)));

  return (
    <Modal transparent animationType="slide">
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{isNew ? 'Add staff' : `Edit ${staff!.name}`}</Text>
            <Pressable onPress={onClose}>
              <X size={20} color={colors.textPrimary} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
            <TextInput style={styles.input} placeholder="Name" value={name} onChangeText={setName} />
            <TextInput
              style={styles.input}
              placeholder="Phone"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
            <TextInput
              style={styles.input}
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <View style={styles.roleRow}>
              {CREATABLE_ROLES.map((r) => (
                <Pressable
                  key={r}
                  style={[styles.roleChip, role === r && styles.roleChipActive]}
                  onPress={() => setRole(r)}
                >
                  <Text style={[styles.roleChipText, role === r && styles.roleChipTextActive]}>{r}</Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              style={styles.input}
              placeholder={isNew ? 'Password' : 'New password (leave blank to keep current)'}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            {role === 'staff' && (
              <>
                <Text style={styles.permHeader}>Page access</Text>
                {groups.map((g) => (
                  <View key={g} style={{ marginBottom: spacing.md }}>
                    <Text style={styles.groupLabel}>{g}</Text>
                    {PAGE_REGISTRY.filter((p) => p.group === g).map((p) => (
                      <View key={p.key} style={styles.permRow}>
                        <Text style={styles.permLabel}>{p.label}</Text>
                        <Switch value={!!perms[p.key]} onValueChange={() => togglePerm(p.key)} />
                      </View>
                    ))}
                  </View>
                ))}
              </>
            )}
            {role !== 'staff' && (
              <Text style={styles.hint}>
                Managers have full access to every page automatically — no need to set permissions.
              </Text>
            )}

            <Pressable style={styles.saveBtn} onPress={save} disabled={saving}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold ?? colors.primary,
    padding: spacing.md,
    borderRadius: 10,
    marginBottom: spacing.lg,
    gap: 6,
  },
  addBtnText: { color: colors.background, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, marginBottom: spacing.sm },
  name: { fontWeight: '700', color: colors.textPrimary },
  inactiveTag: { color: 'crimson', fontWeight: '400', fontSize: 12 },
  meta: { color: colors.textSecondary, fontSize: 12.5, marginTop: 2 },
  iconBtn: { padding: spacing.sm },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: spacing.lg,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  input: {
    borderWidth: 1,
    borderColor: colors.border ?? '#ddd',
    borderRadius: 8,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    color: colors.textPrimary,
  },
  roleRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.sm },
  roleChip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border ?? '#ddd',
  },
  roleChipActive: { backgroundColor: colors.gold ?? colors.primary, borderColor: colors.gold ?? colors.primary },
  roleChipText: { color: colors.textSecondary, fontSize: 12.5 },
  roleChipTextActive: { color: colors.background, fontWeight: '700' },
  permHeader: { fontWeight: '700', color: colors.textPrimary, marginTop: spacing.md, marginBottom: spacing.sm },
  groupLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 4, textTransform: 'uppercase' },
  permRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  permLabel: { color: colors.textPrimary, fontSize: 13.5 },
  hint: { color: colors.textSecondary, fontSize: 12.5, marginTop: spacing.sm },
  saveBtn: {
    backgroundColor: colors.gold ?? colors.primary,
    padding: spacing.md,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  saveBtnText: { color: colors.background, fontWeight: '700' },
});