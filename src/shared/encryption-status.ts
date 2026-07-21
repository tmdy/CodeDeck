export type EncryptionSetupMode = "unlock" | "auto-unlock" | "create" | "migrate-plaintext";
export type EncryptionSetupSource = "canonical" | "legacy-encrypted" | "legacy-plaintext" | "none";

export interface EncryptionSetupStatus {
  mode: EncryptionSetupMode;
  source: EncryptionSetupSource;
}
