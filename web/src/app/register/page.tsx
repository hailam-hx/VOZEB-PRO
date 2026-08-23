import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AuthForm } from "@/components/auth/auth-form";
import { getAuthSettings } from "@/lib/auth/store";
import { getCurrentUser } from "@/lib/auth/session";
import { getInstallStatus } from "@/lib/server/install-status";

type RegisterPageProps = {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
    const t = await getTranslations("auth");
    const params = searchParams ? await searchParams : {};
    const nextPath = safeNextPath(firstValue(params.next));
    const referralCode = firstValue(params.ref)?.trim().toUpperCase() || "";
    const inviteError = firstValue(params.invite) === "invalid" ? t("invalidInvite") : undefined;
    const install = await getInstallStatus();
    if (!install.ready) redirect("/install");

    const [user, settings] = await Promise.all([getCurrentUser(), getAuthSettings()]);
    if (user) redirect(nextPath);

    return (
        <AuthForm
            mode="register"
            nextPath={nextPath}
            registrationEnabled={settings.registrationEnabled}
            emailRegistrationEnabled={settings.emailRegistrationEnabled}
            initialReferralCode={referralCode}
            referralSource={referralCode ? "invite-link" : "registration-form"}
            inviteError={inviteError}
        />
    );
}

function firstValue(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
}

function safeNextPath(value: string | undefined) {
    return value?.startsWith("/") && !value.startsWith("//") ? value : "/create";
}
