import { App } from "antd";
import { describe, expect, it, vi } from "vitest";

import { AuthForm } from "@/components/auth/auth-form";
import { renderWithI18n } from "@/test/render-with-i18n";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

describe("AuthForm translations", () => {
    it.each([
        ["vi", "Đăng nhập", "Tên đăng nhập hoặc email", "Đăng nhập và tiếp tục"],
        ["en", "Log in", "Username or email", "Log in and continue"],
        ["zh-CN", "登录", "用户名或邮箱", "登录并继续"],
    ] as const)("renders the login form in %s", (locale, title, username, submit) => {
        const html = renderWithI18n(
            <App>
                <AuthForm mode="login" variant="embedded" />
            </App>,
            locale,
        );

        expect(html).toContain(title);
        expect(html).toContain(username);
        expect(html).toContain(submit);
    });
});
