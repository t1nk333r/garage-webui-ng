import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DirectoryListingStatus } from "../../types";
import DirectoryListingSection from "./overview-directory-listing";

const mutation = () => ({
  mutate: vi.fn(),
  isPending: false,
  isSuccess: false,
  isError: false,
});

const mocks = vi.hoisted(() => ({
  enable: null as unknown as ReturnType<typeof mutation>,
  disable: null as unknown as ReturnType<typeof mutation>,
  updateBucket: { mutate: (() => {}) as (...args: unknown[]) => void },
  canWrite: true,
}));

vi.mock("../context", () => ({
  useBucketContext: () => ({ bucketName: "my-bucket", bucket: { id: "b1" } }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ canWrite: mocks.canWrite }),
}));

vi.mock("../hooks", () => ({
  useEnableDirectoryListing: () => mocks.enable,
  useDisableDirectoryListing: () => mocks.disable,
  // Present so a regression that reaches for the bucket's website settings
  // from here is caught: removing the listing must never touch them.
  useUpdateBucket: () => mocks.updateBucket,
}));

const status = (
  overrides: Partial<DirectoryListingStatus> = {}
): DirectoryListingStatus => ({
  enabled: false,
  conflict: false,
  websiteAccess: true,
  indexDocument: "index.html",
  available: true,
  pending: false,
  lastSync: null,
  ...overrides,
});

const renderSection = (s: DirectoryListingStatus, websiteAccess = true) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <DirectoryListingSection status={s} websiteAccess={websiteAccess} />
      </MemoryRouter>
    </QueryClientProvider>
  );

describe("DirectoryListingSection", () => {
  beforeEach(() => {
    mocks.enable = mutation();
    mocks.disable = mutation();
    mocks.updateBucket.mutate = vi.fn();
    mocks.canWrite = true;
  });

  it("enabling asks for confirmation before generating anything", async () => {
    const user = userEvent.setup();
    renderSection(status());

    await user.click(screen.getByRole("checkbox"));

    expect(screen.getByText(/publish a directory listing\?/i)).toBeInTheDocument();
    expect(mocks.enable.mutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /publish listing/i }));
    expect(mocks.enable.mutate).toHaveBeenCalledTimes(1);
  });

  it("cancelling the confirmation generates nothing", async () => {
    const user = userEvent.setup();
    renderSection(status());

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(mocks.enable.mutate).not.toHaveBeenCalled();
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("disabling removes the pages without a prompt and leaves website access alone", async () => {
    const user = userEvent.setup();
    renderSection(status({ enabled: true }));

    const toggle = screen.getByRole("checkbox") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    await user.click(toggle);

    expect(mocks.disable.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.updateBucket.mutate).not.toHaveBeenCalled();
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("a bucket with its own index page cannot be switched on", () => {
    renderSection(status({ conflict: true }));

    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(
      screen.getByText(/will not replace or delete it/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /remove generated pages/i })
    ).toBeInTheDocument();
  });

  it("shows the last update and refreshes on demand", async () => {
    const user = userEvent.setup();
    renderSection(
      status({
        enabled: true,
        lastSync: {
          at: new Date().toISOString(),
          folders: 3,
          objects: 12,
          written: 1,
          unchanged: 2,
          deleted: 0,
          userPages: 1,
          unlisted: 0,
          partial: false,
        },
      })
    );

    expect(screen.getByText(/3 folders · 12 files/)).toBeInTheDocument();
    expect(screen.getByText(/1 folder has its own/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /refresh now/i }));
    expect(mocks.enable.mutate).toHaveBeenCalledTimes(1);
  });

  it("offers to remove pages left behind after website access was turned off", async () => {
    const user = userEvent.setup();
    renderSection(status({ enabled: true, websiteAccess: false }), false);

    expect(screen.queryByRole("checkbox")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: /remove listing pages/i })
    );
    expect(mocks.disable.mutate).toHaveBeenCalledTimes(1);
  });

  it("renders nothing with website access off and no pages", () => {
    const { container } = renderSection(status(), false);
    expect(container).toBeEmptyDOMElement();
  });

  it("a viewer sees the state but cannot change it", () => {
    mocks.canWrite = false;
    renderSection(status({ enabled: true, conflict: false }));

    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /refresh now/i })).toBeNull();
  });
});
