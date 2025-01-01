export enum LocalWorkItemState {
    COMPLETED = 'Completed',
    PROPOSED = 'Proposed',
    STARTED = 'Started',
    CUT = 'Cut',
    COMMITTED = 'Committed'
}

export class LocalWorkItemStateHelper {
    static normalize(state: string): LocalWorkItemState {
        const normalizedState = state.trim().toLowerCase();
        const foundState = Object.values(LocalWorkItemState).find(s => s.toLowerCase() === normalizedState);
        if (!foundState) {
            throw new Error(`Invalid state: ${state}`);
        }
        return foundState;
    }
}