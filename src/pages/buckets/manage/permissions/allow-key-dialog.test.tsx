import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AllowKeyDialog from "./allow-key-dialog";

// `vi.mock` is hoisted above the imports, so mutable state it closes over
// has to be hoisted with it — same pattern as website-access.test.tsx.
const mockMutation = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../context", () => ({
  useBucketContext: () => ({
    bucket: { id: "b1", keys: [] },
    refetch: vi.fn(),
    bucketName: "b1",
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ canWrite: true }),
}));

vi.mock("@/pages/keys/hooks", () => ({
  useKeys: () => ({
    data: [
      { id: "GK1", name: "alpha" },
      { id: "GK2", name: "beta" },
    ],
  }),
}));

vi.mock("../hooks", () => ({
  useAllowKey: () => mockMutation,
}));

vi.mock("sonner", () => ({ toast: mockToast }));

const renderDialog = (
  client: QueryClient,
  currentKeys: string[] | undefined
) => {
  const utils = render(
    <QueryClientProvider client={client}>
      <AllowKeyDialog currentKeys={currentKeys} />
    </QueryClientProvider>
  );

  return utils;
};

// Locates the per-row checkboxes for a given key's display name. The row's
// Key checkbox has an accessible name (the key name); Read/Write/Owner do
// not, so they are found positionally within the same <tr>.
const getRowCheckboxes = (keyName: string) => {
  const keyCheckbox = screen.getByRole("checkbox", { name: keyName });
  const row = keyCheckbox.closest("tr");
  if (!row) throw new Error(`row for ${keyName} not found`);
  const [key, read, write, owner] = within(row).getAllByRole("checkbox");
  return { key, read, write, owner };
};

const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /allow key/i }));
};

describe("AllowKeyDialog", () => {
  beforeEach(() => {
    mockMutation.mutate.mockClear();
    mockToast.success.mockClear();
    mockToast.error.mockClear();
  });

  it("rejects a submit with nothing ticked", async () => {
    const user = userEvent.setup();
    renderDialog(new QueryClient(), []);
    await openDialog(user);

    await user.click(screen.getByRole("button", { name: /submit/i }));

    expect(mockToast.error).toHaveBeenCalledWith(
      "Select at least one key to allow."
    );
    expect(mockMutation.mutate).not.toHaveBeenCalled();
  });

  it("ticking Read on a row auto-selects it and submits that key only", async () => {
    const user = userEvent.setup();
    renderDialog(new QueryClient(), []);
    await openDialog(user);

    const { read, key } = getRowCheckboxes("alpha");
    await user.click(read);

    await waitFor(() => expect(key).toBeChecked());

    await user.click(screen.getByRole("button", { name: /submit/i }));

    expect(mockMutation.mutate).toHaveBeenCalledTimes(1);
    expect(mockMutation.mutate).toHaveBeenCalledWith([
      { keyId: "GK1", permissions: { read: true, write: false, owner: false } },
    ]);
  });

  it("rejects a selected key with no permission ticked", async () => {
    const user = userEvent.setup();
    renderDialog(new QueryClient(), []);
    await openDialog(user);

    const { key } = getRowCheckboxes("alpha");
    await user.click(key);

    await user.click(screen.getByRole("button", { name: /submit/i }));

    expect(mockToast.error).toHaveBeenCalledWith(
      "Each selected key needs at least one permission."
    );
    expect(mockMutation.mutate).not.toHaveBeenCalled();
  });

  it("submits exactly the selected key with its ticked permission", async () => {
    const user = userEvent.setup();
    renderDialog(new QueryClient(), []);
    await openDialog(user);

    const { key, write } = getRowCheckboxes("beta");
    await user.click(key);
    await user.click(write);

    await user.click(screen.getByRole("button", { name: /submit/i }));

    expect(mockMutation.mutate).toHaveBeenCalledTimes(1);
    expect(mockMutation.mutate).toHaveBeenCalledWith([
      { keyId: "GK2", permissions: { read: false, write: true, owner: false } },
    ]);
  });

  it("keeps a selection when the parent re-renders with an equal-but-new currentKeys array", async () => {
    const user = userEvent.setup();
    const client = new QueryClient();
    const { rerender } = renderDialog(client, []);
    await openDialog(user);

    const { key } = getRowCheckboxes("alpha");
    await user.click(key);
    expect(key).toBeChecked();

    rerender(
      <QueryClientProvider client={client}>
        <AllowKeyDialog currentKeys={[]} />
      </QueryClientProvider>
    );

    const { key: keyAfterRerender } = getRowCheckboxes("alpha");
    expect(keyAfterRerender).toBeChecked();
  });
});
