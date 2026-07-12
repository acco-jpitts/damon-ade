import { useCommandWatcher } from "./hooks/useCommandWatcher";

/**
 * Component that runs agent-related hooks requiring CollectionsProvider context.
 * useCommandWatcher uses useCollections which must be inside the provider.
 */
export function AgentHooks() {
	useCommandWatcher();
	return null;
}
