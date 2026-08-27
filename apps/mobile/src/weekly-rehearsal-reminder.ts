export const weeklyRehearsalReminderMarker = 'weekly_rehearsal';
export const weeklyRehearsalReminderSeconds = 7 * 24 * 60 * 60;
export const weeklyRehearsalReminderChannelId = 'weekly-safety-practice';

type ReminderPermissionStatus = Readonly<{
  granted: boolean;
  canAskAgain: boolean;
  ios?: Readonly<{ status: number }>;
}>;

type ScheduledReminder = Readonly<{
  identifier: string;
  content: Readonly<{ data?: Record<string, unknown> }>;
}>;

export type WeeklyReminderGateway = Readonly<{
  platform: 'android' | 'ios' | 'unsupported';
  disableRemoteRegistration: () => Promise<void>;
  configureForegroundPresentation: () => void;
  ensureQuietChannel: () => Promise<void>;
  getPermissions: () => Promise<ReminderPermissionStatus>;
  requestPermissions: () => Promise<ReminderPermissionStatus>;
  listScheduled: () => Promise<readonly ScheduledReminder[]>;
  cancelScheduled: (identifier: string) => Promise<void>;
  scheduleWeekly: () => Promise<string>;
}>;

export type WeeklyReminderState = Readonly<{
  state: 'scheduled' | 'not_scheduled' | 'permission_denied' | 'unsupported' | 'error';
  deviceProof: 'pending';
  canAskAgain: boolean;
}>;

function isWeeklyRehearsalReminder(reminder: ScheduledReminder): boolean {
  return reminder.content.data?.kind === weeklyRehearsalReminderMarker;
}

export function weeklyReminderPermissionIsGranted(status: ReminderPermissionStatus): boolean {
  if (status.granted) return true;
  // Expo SDK 57: 2 is authorized, 3 is provisional, and 4 is ephemeral on iOS.
  return status.ios !== undefined && [2, 3, 4].includes(status.ios.status);
}

async function cancelMarkerScheduledReminders(gateway: WeeklyReminderGateway): Promise<void> {
  const scheduled = await gateway.listScheduled();
  await Promise.all(
    scheduled
      .filter(isWeeklyRehearsalReminder)
      .map((reminder) => gateway.cancelScheduled(reminder.identifier)),
  );
}

async function nativeWeeklyReminderGateway(): Promise<WeeklyReminderGateway | undefined> {
  const { Platform } = await import('react-native');
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return undefined;
  const Notifications = await import('expo-notifications');
  const platform = Platform.OS;
  return {
    platform,
    disableRemoteRegistration: () => Notifications.setAutoServerRegistrationEnabledAsync(false),
    configureForegroundPresentation: () => {
      Notifications.setNotificationHandler({
        handleNotification: async (notification) => {
          const isWeeklyReminder =
            notification.request.content.data?.kind === weeklyRehearsalReminderMarker;
          return {
            shouldShowBanner: isWeeklyReminder,
            shouldShowList: isWeeklyReminder,
            shouldPlaySound: false,
            shouldSetBadge: false,
          };
        },
      });
    },
    ensureQuietChannel: async () => {
      if (platform !== 'android') return;
      await Notifications.setNotificationChannelAsync(weeklyRehearsalReminderChannelId, {
        name: 'Weekly safety practice',
        description: 'Optional, generic reminders to open BoomerBuddy for a short practice.',
        importance: Notifications.AndroidImportance.LOW,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
        showBadge: false,
        sound: null,
        enableVibrate: false,
        vibrationPattern: null,
      });
    },
    getPermissions: () => Notifications.getPermissionsAsync(),
    requestPermissions: () =>
      Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: false,
          allowSound: false,
          allowCriticalAlerts: false,
          allowDisplayInCarPlay: false,
          allowProvisional: false,
        },
      }),
    listScheduled: () => Notifications.getAllScheduledNotificationsAsync(),
    cancelScheduled: (identifier) => Notifications.cancelScheduledNotificationAsync(identifier),
    scheduleWeekly: () =>
      Notifications.scheduleNotificationAsync({
        content: {
          title: 'A quick safety practice is ready',
          body: 'Open BoomerBuddy when you are ready.',
          data: { kind: weeklyRehearsalReminderMarker },
          sound: false,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: weeklyRehearsalReminderSeconds,
          repeats: true,
          ...(platform === 'android' ? { channelId: weeklyRehearsalReminderChannelId } : {}),
        },
      }),
  };
}

async function resolveGateway(
  supplied?: WeeklyReminderGateway,
): Promise<WeeklyReminderGateway | undefined> {
  return supplied ?? nativeWeeklyReminderGateway();
}

export async function prepareWeeklyReminderBoundary(
  supplied?: WeeklyReminderGateway,
): Promise<void> {
  const gateway = await resolveGateway(supplied);
  if (!gateway) return;
  await gateway.disableRemoteRegistration();
  gateway.configureForegroundPresentation();
}

export async function readWeeklyReminderState(
  supplied?: WeeklyReminderGateway,
): Promise<WeeklyReminderState> {
  try {
    const gateway = await resolveGateway(supplied);
    if (!gateway) {
      return { state: 'unsupported', deviceProof: 'pending', canAskAgain: false };
    }
    await gateway.disableRemoteRegistration();
    const permission = await gateway.getPermissions();
    const scheduled = await gateway.listScheduled();
    if (
      scheduled.some(isWeeklyRehearsalReminder) &&
      weeklyReminderPermissionIsGranted(permission)
    ) {
      return { state: 'scheduled', deviceProof: 'pending', canAskAgain: permission.canAskAgain };
    }
    if (!weeklyReminderPermissionIsGranted(permission) && !permission.canAskAgain) {
      return { state: 'permission_denied', deviceProof: 'pending', canAskAgain: false };
    }
    return { state: 'not_scheduled', deviceProof: 'pending', canAskAgain: permission.canAskAgain };
  } catch {
    return { state: 'error', deviceProof: 'pending', canAskAgain: false };
  }
}

export async function enableWeeklyRehearsalReminder(
  supplied?: WeeklyReminderGateway,
): Promise<WeeklyReminderState> {
  try {
    const gateway = await resolveGateway(supplied);
    if (!gateway) {
      return { state: 'unsupported', deviceProof: 'pending', canAskAgain: false };
    }
    await gateway.disableRemoteRegistration();
    gateway.configureForegroundPresentation();
    await gateway.ensureQuietChannel();
    let permission = await gateway.getPermissions();
    if (!weeklyReminderPermissionIsGranted(permission) && permission.canAskAgain) {
      permission = await gateway.requestPermissions();
    }
    if (!weeklyReminderPermissionIsGranted(permission)) {
      await cancelMarkerScheduledReminders(gateway);
      return {
        state: 'permission_denied',
        deviceProof: 'pending',
        canAskAgain: permission.canAskAgain,
      };
    }
    await cancelMarkerScheduledReminders(gateway);
    await gateway.scheduleWeekly();
    return { state: 'scheduled', deviceProof: 'pending', canAskAgain: permission.canAskAgain };
  } catch {
    return { state: 'error', deviceProof: 'pending', canAskAgain: false };
  }
}

export async function disableWeeklyRehearsalReminder(
  supplied?: WeeklyReminderGateway,
): Promise<WeeklyReminderState> {
  try {
    const gateway = await resolveGateway(supplied);
    if (!gateway) {
      return { state: 'unsupported', deviceProof: 'pending', canAskAgain: false };
    }
    await gateway.disableRemoteRegistration();
    await cancelMarkerScheduledReminders(gateway);
    const permission = await gateway.getPermissions();
    return {
      state: 'not_scheduled',
      deviceProof: 'pending',
      canAskAgain: permission.canAskAgain,
    };
  } catch {
    return { state: 'error', deviceProof: 'pending', canAskAgain: false };
  }
}
