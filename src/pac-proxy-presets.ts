import type { PacProxyStatus } from "./desktop-types";

export function defaultPacProxyOptions(): PacProxyStatus["pacOptions"] {
  return [
    { key: "jp", label: "日本（Japan）", url: "http://10.12.0.24/proxy.pac" },
    { key: "us", label: "美国（US）", url: "http://10.12.0.24/proxy-us.pac" },
    { key: "ca", label: "加拿大（Canada）", url: "http://10.12.0.24/proxy-ca.pac" },
  ];
}

export function pacProxyOptionByKey(selectedPacKey: string): PacProxyStatus["pacOptions"][number] {
  return defaultPacProxyOptions().find((option) => option.key === selectedPacKey)
    ?? defaultPacProxyOptions()[0];
}

export function selectedPacProxyOptionLabel(status: PacProxyStatus): string {
  return status.pacOptions.find((option) => option.key === status.selectedPacKey)?.label
    ?? status.pacUrl;
}

export function previewPacProxyStatus(enabled: boolean = false, selectedPacKey: string = "jp"): PacProxyStatus {
  const availableServices = ["Ethernet", "Wi-Fi", "iPhone USB"];
  const selectedServices = ["Ethernet", "Wi-Fi"];
  const selectedOption = pacProxyOptionByKey(selectedPacKey);
  return {
    supported: true,
    enabled,
    pacUrl: selectedOption.url,
    selectedPacKey: selectedOption.key,
    pacOptions: defaultPacProxyOptions(),
    availableServices,
    selectedServices,
    services: enabled ? selectedServices : [],
    message: "当前是浏览器预览模式，不会修改系统代理。",
  };
}
