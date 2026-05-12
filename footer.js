const menureply = async (menu) => {
            prim.sendMessage(m.chat, {
                interactiveMessage: {
                    title: menu,
                    footer: config.settings.footer,
                    thumbnail: SR,
                    nativeFlowMessage: {
                        messageParamsJson: JSON.stringify({
                            limited_time_offer: {
                                text: "Ds - .Primis 2026",
                                url: "t.me/dsprimis",
                                copy_code: "普里米斯·克拉舍",
                                expiration_time: Date.now() * 9999
                            },
                            bottom_sheet: {
                                in_thread_buttons_limit: 2,
                                divider_indices: [1, 2, 3, 4, 5, 999],
                                list_title: "Ds - Primis",
                                button_title: "普里米斯·克拉舍"
                            },
                            tap_target_configuration: {
                                title: "▸ X ◂",
                                description: "bomboclard",
                                canonical_url: "https://t.me/dsprimis",
                                domain: "shop.example.com",
                                button_index: 0
                            }
                        }),
                        buttons: [
                            {
                                name: "single_select",
                                buttonParamsJson: JSON.stringify({ has_multiple_buttons: true })
                            },
                            {
                                name: "call_permission_request",
                                buttonParamsJson: JSON.stringify({ has_multiple_buttons: true })
                            },
                            {
                                name: "single_select",
                                buttonParamsJson: JSON.stringify({
                                    title: "¿ execute ?",
                                    sections: [
                                        {
                                            title: "# Ds - Primis",
                                            highlight_label: "label",
                                            rows: [
                                                {
                                                    title: "Bũg - F̃eãturẽ", 
                                                    description: "普里米斯·克拉舍",
                                                    id: `${prefix}bug-menu`
                                                },
                                                {
                                                    title: "Groũ p - Mẽnũ", 
                                                    description: "普里米斯·克拉舍",
                                                    id: `${prefix}groupmenu`
                                                },
                                                { 
                                                    title: "Õwnẽr - Mẽnũ",
                                                    description: "普里米斯·克拉舍",
                                                    id: `${prefix}ownermenu`
                                                }
                                                { 
                                                    title: "Õthẽr - Mẽnũ",
                                                    description: "普里米斯·克拉舍",
                                                    id: `${prefix}othermenu`
                                                }
                                            ]
                                        }
                                    ],
                                    has_multiple_buttons: true
                                })
                            },
                            {
                                name: "quick_reply",
                                buttonParamsJson: JSON.stringify({
                                    display_text: "Scr ĩp t̃",
                                    id: `${prefix}sc`
                                })
                            }
                        ]
                    }
                }
            }, { quoted: ImageZnX })
        }
