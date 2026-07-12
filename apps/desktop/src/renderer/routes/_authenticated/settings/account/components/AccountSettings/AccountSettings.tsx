import { Button } from "@superset/ui/button";
import { toast } from "@superset/ui/sonner";
import { electronTrpc } from "renderer/lib/electron-trpc";
import {
	isItemVisible,
	SETTING_ITEM_ID,
	type SettingItemId,
} from "../../../utils/settings-search";

interface AccountSettingsProps {
	visibleItems?: SettingItemId[] | null;
}

export function AccountSettings({ visibleItems }: AccountSettingsProps) {
	const showSignOut = isItemVisible(
		SETTING_ITEM_ID.ACCOUNT_SIGNOUT,
		visibleItems,
	);

	const signOutMutation = electronTrpc.auth.signOut.useMutation({
		onSuccess: () => toast.success("Signed out"),
	});

	return (
		<div className="p-6 max-w-4xl w-full">
			<div className="mb-8">
				<h2 className="text-xl font-semibold">Account</h2>
				<p className="text-sm text-muted-foreground mt-1">
					Manage your account settings
				</p>
			</div>

			<div className="space-y-8">
				{showSignOut && (
					<div>
						<h3 className="text-sm font-medium mb-2">Sign Out</h3>
						<p className="text-sm text-muted-foreground mb-4">
							Sign out of your ADE account on this device.
						</p>
						<Button variant="outline" onClick={() => signOutMutation.mutate()}>
							Sign Out
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
