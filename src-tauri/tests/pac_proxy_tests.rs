use codex_auth_switch_lib::core::{
    pac_proxy_status_from_macos_services, pac_proxy_status_from_macos_services_with_selection,
    pac_proxy_status_from_macos_services_with_selection_and_pac_key, parse_macos_auto_proxy_status,
    parse_windows_auto_config_url, windows_pac_proxy_status_from_auto_config_url,
    windows_registry_command_creation_flags, PacProxyOption, PacProxyStatus, DEFAULT_PAC_PROXY_KEY,
    PAC_PROXY_CA_URL, PAC_PROXY_URL, PAC_PROXY_US_URL,
};

#[test]
fn parses_macos_auto_proxy_status_output() {
    let status =
        parse_macos_auto_proxy_status("Wi-Fi", "URL: http://10.12.0.24/proxy.pac\nEnabled: Yes\n");

    assert_eq!(status.service, "Wi-Fi");
    assert_eq!(status.url.as_deref(), Some(PAC_PROXY_URL));
    assert!(status.enabled);
}

#[test]
fn exposes_japan_us_and_canada_pac_options_with_japan_default() {
    let status = pac_proxy_status_from_macos_services(Vec::new());

    assert_eq!(status.selected_pac_key, DEFAULT_PAC_PROXY_KEY);
    assert_eq!(status.pac_url, PAC_PROXY_URL);
    assert_eq!(
        status.pac_options,
        vec![
            PacProxyOption {
                key: "jp".into(),
                label: "日本（Japan）".into(),
                url: PAC_PROXY_URL.into(),
            },
            PacProxyOption {
                key: "us".into(),
                label: "美国（US）".into(),
                url: PAC_PROXY_US_URL.into(),
            },
            PacProxyOption {
                key: "ca".into(),
                label: "加拿大（Canada）".into(),
                url: PAC_PROXY_CA_URL.into(),
            },
        ]
    );
}

#[test]
fn marks_pac_proxy_enabled_when_managed_url_is_active() {
    let status = pac_proxy_status_from_macos_services(vec![
        parse_macos_auto_proxy_status("Wi-Fi", "URL: http://10.12.0.24/proxy.pac\nEnabled: Yes\n"),
        parse_macos_auto_proxy_status(
            "USB 10/100/1000 LAN",
            "URL: http://example.test/other.pac\nEnabled: No\n",
        ),
    ]);

    assert_eq!(
        status,
        PacProxyStatus {
            supported: true,
            enabled: true,
            pac_url: PAC_PROXY_URL.into(),
            selected_pac_key: DEFAULT_PAC_PROXY_KEY.into(),
            pac_options: vec![
                PacProxyOption {
                    key: "jp".into(),
                    label: "日本（Japan）".into(),
                    url: PAC_PROXY_URL.into(),
                },
                PacProxyOption {
                    key: "us".into(),
                    label: "美国（US）".into(),
                    url: PAC_PROXY_US_URL.into(),
                },
                PacProxyOption {
                    key: "ca".into(),
                    label: "加拿大（Canada）".into(),
                    url: PAC_PROXY_CA_URL.into(),
                },
            ],
            available_services: vec!["Wi-Fi".into(), "USB 10/100/1000 LAN".into()],
            selected_services: vec!["Wi-Fi".into(), "USB 10/100/1000 LAN".into()],
            services: vec!["Wi-Fi".into()],
            message: None,
        }
    );
}

#[test]
fn marks_pac_proxy_disabled_when_url_is_not_active() {
    let status = pac_proxy_status_from_macos_services(vec![
        parse_macos_auto_proxy_status("Wi-Fi", "URL: http://10.12.0.24/proxy.pac\nEnabled: No\n"),
        parse_macos_auto_proxy_status(
            "Ethernet",
            "URL: http://example.test/other.pac\nEnabled: Yes\n",
        ),
    ]);

    assert!(!status.enabled);
    assert_eq!(status.services, Vec::<String>::new());
    assert_eq!(status.pac_url, PAC_PROXY_URL);
    assert_eq!(status.selected_pac_key, DEFAULT_PAC_PROXY_KEY);
}

#[test]
fn selected_services_limit_the_effective_pac_proxy_status() {
    let status = pac_proxy_status_from_macos_services_with_selection(
        vec![
            parse_macos_auto_proxy_status(
                "Ethernet",
                "URL: http://10.12.0.24/proxy.pac\nEnabled: Yes\n",
            ),
            parse_macos_auto_proxy_status(
                "Wi-Fi",
                "URL: http://10.12.0.24/proxy.pac\nEnabled: Yes\n",
            ),
            parse_macos_auto_proxy_status(
                "iPhone USB",
                "URL: http://10.12.0.24/proxy.pac\nEnabled: No\n",
            ),
        ],
        vec!["Wi-Fi".into(), "Missing".into()],
    );

    assert!(status.enabled);
    assert_eq!(
        status.available_services,
        vec!["Ethernet", "Wi-Fi", "iPhone USB"]
    );
    assert_eq!(status.selected_services, vec!["Wi-Fi"]);
    assert_eq!(status.services, vec!["Wi-Fi"]);
}

#[test]
fn selected_pac_option_controls_the_effective_macos_url() {
    let status = pac_proxy_status_from_macos_services_with_selection_and_pac_key(
        vec![
            parse_macos_auto_proxy_status(
                "Ethernet",
                "URL: http://10.12.0.24/proxy-us.pac\nEnabled: Yes\n",
            ),
            parse_macos_auto_proxy_status(
                "Wi-Fi",
                "URL: http://10.12.0.24/proxy.pac\nEnabled: Yes\n",
            ),
        ],
        vec!["Ethernet".into(), "Wi-Fi".into()],
        Some("us".into()),
    );

    assert!(status.enabled);
    assert_eq!(status.selected_pac_key, "us");
    assert_eq!(status.pac_url, PAC_PROXY_US_URL);
    assert_eq!(status.services, vec!["Ethernet"]);
}

#[test]
fn active_managed_pac_url_is_reflected_when_no_saved_option_exists() {
    let status = pac_proxy_status_from_macos_services_with_selection(
        vec![parse_macos_auto_proxy_status(
            "Wi-Fi",
            "URL: http://10.12.0.24/proxy-ca.pac\nEnabled: Yes\n",
        )],
        vec!["Wi-Fi".into()],
    );

    assert!(status.enabled);
    assert_eq!(status.selected_pac_key, "ca");
    assert_eq!(status.pac_url, PAC_PROXY_CA_URL);
    assert_eq!(status.services, vec!["Wi-Fi"]);
}

#[test]
fn stale_selected_services_fall_back_to_available_services() {
    let status = pac_proxy_status_from_macos_services_with_selection(
        vec![parse_macos_auto_proxy_status(
            "Wi-Fi",
            "URL: http://10.12.0.24/proxy.pac\nEnabled: Yes\n",
        )],
        vec!["Old USB".into()],
    );

    assert_eq!(status.selected_services, vec!["Wi-Fi"]);
    assert_eq!(status.services, vec!["Wi-Fi"]);
}

#[test]
fn parses_windows_auto_config_url_from_reg_output() {
    let output = r#"
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings
    AutoConfigURL    REG_SZ    http://10.12.0.24/proxy.pac
"#;

    assert_eq!(
        parse_windows_auto_config_url(output).as_deref(),
        Some(PAC_PROXY_URL)
    );
}

#[test]
fn marks_windows_pac_proxy_enabled_when_managed_url_is_set() {
    let status = windows_pac_proxy_status_from_auto_config_url(Some(PAC_PROXY_URL.into()));

    assert_eq!(
        status,
        PacProxyStatus {
            supported: true,
            enabled: true,
            pac_url: PAC_PROXY_URL.into(),
            selected_pac_key: DEFAULT_PAC_PROXY_KEY.into(),
            pac_options: vec![
                PacProxyOption {
                    key: "jp".into(),
                    label: "日本（Japan）".into(),
                    url: PAC_PROXY_URL.into(),
                },
                PacProxyOption {
                    key: "us".into(),
                    label: "美国（US）".into(),
                    url: PAC_PROXY_US_URL.into(),
                },
                PacProxyOption {
                    key: "ca".into(),
                    label: "加拿大（Canada）".into(),
                    url: PAC_PROXY_CA_URL.into(),
                },
            ],
            available_services: vec!["Windows 设置脚本".into()],
            selected_services: vec!["Windows 设置脚本".into()],
            services: vec!["Windows 设置脚本".into()],
            message: None,
        }
    );
}

#[test]
fn marks_windows_pac_proxy_enabled_when_any_managed_url_is_set() {
    let status = windows_pac_proxy_status_from_auto_config_url(Some(PAC_PROXY_CA_URL.into()));

    assert!(status.enabled);
    assert_eq!(status.selected_pac_key, "ca");
    assert_eq!(status.pac_url, PAC_PROXY_CA_URL);
    assert_eq!(status.services, vec!["Windows 设置脚本"]);
}

#[test]
fn marks_windows_pac_proxy_disabled_when_url_is_missing_or_external() {
    for auto_config_url in [None, Some("http://example.test/other.pac".into())] {
        let status = windows_pac_proxy_status_from_auto_config_url(auto_config_url);

        assert!(status.supported);
        assert!(!status.enabled);
        assert_eq!(status.available_services, vec!["Windows 设置脚本"]);
        assert_eq!(status.selected_services, vec!["Windows 设置脚本"]);
        assert_eq!(status.services, Vec::<String>::new());
        assert_eq!(status.pac_url, PAC_PROXY_URL);
        assert_eq!(status.selected_pac_key, DEFAULT_PAC_PROXY_KEY);
        assert_eq!(status.message, None);
    }
}

#[test]
fn windows_registry_commands_are_created_without_a_console_window() {
    assert_eq!(windows_registry_command_creation_flags(), 0x08000000);
}
