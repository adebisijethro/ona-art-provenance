use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("OnaPrv1111111111111111111111111111111111111");

pub const MAX_ROYALTY_BPS: u16 = 2_500; // 25.00%
pub const MAX_PROTOCOL_FEE_BPS: u16 = 800; // 8.00%
pub const BPS_DENOMINATOR: u64 = 10_000;
pub const MAX_CID_LEN: usize = 96;

#[program]
pub mod ona_provenance {
    use super::*;

    /// Initializes the global Ona protocol configuration PDA.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        protocol_fee_bps: u16,
    ) -> Result<()> {
        require!(
            protocol_fee_bps <= MAX_PROTOCOL_FEE_BPS,
            OnaError::InvalidProtocolFeeBps
        );

        let cfg = &mut ctx.accounts.config;
        cfg.admin = ctx.accounts.admin.key();
        cfg.pending_admin = Pubkey::default();
        cfg.custodial_relayer = ctx.accounts.custodial_relayer.key();
        cfg.nfc_sun_verifier = ctx.accounts.nfc_sun_verifier.key();
        cfg.protocol_treasury = ctx.accounts.protocol_treasury.key();
        cfg.protocol_fee_bps = protocol_fee_bps;
        cfg.total_minted = 0;
        cfg.bump = ctx.bumps.config;

        Ok(())
    }

    /// Two-step admin rotation (Step 1: nominate pending admin).
    pub fn transfer_admin(ctx: Context<TransferAdmin>) -> Result<()> {
        let new_admin = ctx.accounts.new_pending_admin.key();
        require!(new_admin != Pubkey::default(), OnaError::InvalidAddress);
        ctx.accounts.config.pending_admin = new_admin;
        Ok(())
    }

    /// Two-step admin rotation (Step 2: pending admin accepts role).
    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        cfg.admin = ctx.accounts.pending_admin.key();
        cfg.pending_admin = Pubkey::default();
        Ok(())
    }

    /// Mints an Ona Artwork Provenance PDA paired to an NTAG 424 DNA hardware tag hash
    /// and optionally locks SPL / Token-2022 (USDC) primary funds in a PDA escrow vault.
    pub fn mint_certificate(
        ctx: Context<MintCertificate>,
        tag_hardware_hash: [u8; 32],
        royalty_bps: u16,
        edition_index: u16,
        edition_total: u16,
        is_custodial_vault: bool,
        ipfs_provenance_cid: String,
        escrow_amount: u64,
        recorded_primary_price: u64,
    ) -> Result<()> {
        require!(royalty_bps <= MAX_ROYALTY_BPS, OnaError::InvalidRoyaltyBps);
        require!(
            edition_index >= 1 && edition_index <= edition_total,
            OnaError::InvalidEdition
        );
        require!(
            !ipfs_provenance_cid.is_empty() && ipfs_provenance_cid.len() <= MAX_CID_LEN,
            OnaError::InvalidCidLength
        );
        require!(tag_hardware_hash != [0u8; 32], OnaError::InvalidTagHash);

        let cfg = &mut ctx.accounts.config;
        let caller = ctx.accounts.authority.key();
        require!(
            caller == cfg.admin || caller == cfg.custodial_relayer,
            OnaError::Unauthorized
        );

        cfg.total_minted = cfg
            .total_minted
            .checked_add(1)
            .ok_or(OnaError::MathOverflow)?;
        let token_id = cfg.total_minted;

        let art = &mut ctx.accounts.artwork;
        art.token_id = token_id;
        art.artist = ctx.accounts.artist.key();
        art.owner = ctx.accounts.buyer_recipient.key();
        art.payment_mint = ctx.accounts.payment_mint.key();
        art.royalty_bps = royalty_bps;
        art.tag_hardware_hash = tag_hardware_hash;
        art.last_tap_counter = 0;
        art.edition_index = edition_index;
        art.edition_total = edition_total;
        art.escrow_amount = escrow_amount;
        art.escrow_released = escrow_amount == 0;
        art.physical_verified = false;
        art.custodial_held = is_custodial_vault;
        art.resale_active = false;
        art.resale_ask_price = 0;
        art.recorded_primary_price = recorded_primary_price;
        art.ipfs_provenance_cid = ipfs_provenance_cid.clone();
        art.bump = ctx.bumps.artwork;

        if escrow_amount > 0 {
            let decimals = ctx.accounts.payment_mint.decimals;
            let cpi_accounts = TransferChecked {
                from: ctx.accounts.payer_token_account.to_account_info(),
                mint: ctx.accounts.payment_mint.to_account_info(),
                to: ctx.accounts.escrow_vault.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            };
            let cpi_ctx = CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
            );
            token_interface::transfer_checked(cpi_ctx, escrow_amount, decimals)?;
        }

        emit!(CertificateMintedEvent {
            token_id,
            artist: art.artist,
            owner: art.owner,
            tag_hardware_hash,
            royalty_bps,
            escrow_amount,
            ipfs_provenance_cid,
        });

        Ok(())
    }

    /// Confirms physical delivery when the collector taps the NTAG 424 DNA seal:
    /// requires co-signature from `nfc_sun_verifier`, monotonic counter increase,
    /// non-expired deadline, and releases escrowed USDC/SPL tokens to the artist.
    pub fn confirm_physical_delivery(
        ctx: Context<ConfirmPhysicalDelivery>,
        tap_counter: u32,
        signature_deadline: i64,
    ) -> Result<()> {
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp <= signature_deadline,
            OnaError::SignatureExpired
        );

        let cfg = &ctx.accounts.config;
        let art = &mut ctx.accounts.artwork;
        let caller = ctx.accounts.caller.key();

        let authorized = caller == art.owner
            || (caller == cfg.custodial_relayer && art.custodial_held);
        require!(authorized, OnaError::Unauthorized);
        require!(
            ctx.accounts.nfc_sun_verifier.key() == cfg.nfc_sun_verifier,
            OnaError::InvalidNfcVerifier
        );
        require!(
            tap_counter > art.last_tap_counter,
            OnaError::InvalidNfcCounter
        );

        art.last_tap_counter = tap_counter;
        art.physical_verified = true;

        let mut released_amount: u64 = 0;
        if art.escrow_amount > 0 && !art.escrow_released {
            art.escrow_released = true;
            released_amount = art.escrow_amount;

            let hash_seed = art.tag_hardware_hash;
            let bump_seed = [art.bump];
            let signer_seeds: &[&[&[u8]]] = &[&[b"artwork", hash_seed.as_ref(), &bump_seed]];

            let decimals = ctx.accounts.payment_mint.decimals;
            let cpi_accounts = TransferChecked {
                from: ctx.accounts.escrow_vault.to_account_info(),
                mint: ctx.accounts.payment_mint.to_account_info(),
                to: ctx.accounts.artist_token_account.to_account_info(),
                authority: art.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            );
            token_interface::transfer_checked(cpi_ctx, released_amount, decimals)?;
        }

        emit!(PhysicalDeliveryConfirmedEvent {
            token_id: art.token_id,
            collector: art.owner,
            artist: art.artist,
            tap_counter,
            escrow_released: released_amount,
        });

        Ok(())
    }

    /// Lists a verified certificate for secondary market resale.
    pub fn list_for_resale(ctx: Context<ManageResaleListing>, ask_price: u64) -> Result<()> {
        require!(ask_price > 0, OnaError::InsufficientPayment);
        let cfg = &ctx.accounts.config;
        let art = &mut ctx.accounts.artwork;
        require!(art.escrow_released, OnaError::DeliveryEscrowPending);

        let caller = ctx.accounts.caller.key();
        let authorized = caller == art.owner
            || (caller == cfg.custodial_relayer && art.custodial_held);
        require!(authorized, OnaError::Unauthorized);

        art.resale_active = true;
        art.resale_ask_price = ask_price;

        Ok(())
    }

    /// Cancels an active secondary resale listing.
    pub fn cancel_resale_listing(ctx: Context<ManageResaleListing>) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let art = &mut ctx.accounts.artwork;
        require!(art.resale_active, OnaError::NotListedForResale);

        let caller = ctx.accounts.caller.key();
        let authorized = caller == art.owner
            || (caller == cfg.custodial_relayer && art.custodial_held);
        require!(authorized, OnaError::Unauthorized);

        art.resale_active = false;
        art.resale_ask_price = 0;

        Ok(())
    }

    /// Atomically settles a secondary market resale in SPL / Token-2022 (USDC),
    /// enforcing creator royalties directly to `art.artist`, fee to `protocol_treasury`,
    /// and net proceeds to the selling collector.
    pub fn settle_secondary_resale(
        ctx: Context<SettleSecondaryResale>,
        new_collector_is_custodial: bool,
        nfc_tap_counter: u32,
        signature_deadline: i64,
    ) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let art = &mut ctx.accounts.artwork;

        require!(art.resale_active, OnaError::NotListedForResale);
        let seller = art.owner;
        let new_collector = ctx.accounts.new_collector.key();
        require!(new_collector != Pubkey::default(), OnaError::InvalidAddress);
        require!(new_collector != seller, OnaError::SelfPurchaseDisallowed);

        if new_collector_is_custodial {
            let buyer_payer = ctx.accounts.buyer_payer.key();
            require!(
                buyer_payer == cfg.custodial_relayer || buyer_payer == cfg.admin,
                OnaError::Unauthorized
            );
        }

        if nfc_tap_counter > 0 {
            let clock = Clock::get()?;
            require!(
                clock.unix_timestamp <= signature_deadline,
                OnaError::SignatureExpired
            );
            require!(
                nfc_tap_counter > art.last_tap_counter,
                OnaError::InvalidNfcCounter
            );
            require!(
                ctx.accounts.nfc_sun_verifier.is_signer
                    && ctx.accounts.nfc_sun_verifier.key() == cfg.nfc_sun_verifier,
                OnaError::InvalidNfcVerifier
            );
            art.last_tap_counter = nfc_tap_counter;
        }

        let gross = art.resale_ask_price;
        let artist_royalty = gross
            .checked_mul(art.royalty_bps as u64)
            .ok_or(OnaError::MathOverflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(OnaError::MathOverflow)?;
        let fee_amount = gross
            .checked_mul(cfg.protocol_fee_bps as u64)
            .ok_or(OnaError::MathOverflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(OnaError::MathOverflow)?;
        let seller_net = gross
            .checked_sub(artist_royalty)
            .ok_or(OnaError::MathOverflow)?
            .checked_sub(fee_amount)
            .ok_or(OnaError::MathOverflow)?;

        // Effects before CPIs
        art.resale_active = false;
        art.resale_ask_price = 0;
        art.owner = new_collector;
        art.custodial_held = new_collector_is_custodial;

        let decimals = ctx.accounts.payment_mint.decimals;

        if artist_royalty > 0 {
            token_interface::transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.buyer_token_account.to_account_info(),
                        mint: ctx.accounts.payment_mint.to_account_info(),
                        to: ctx.accounts.artist_token_account.to_account_info(),
                        authority: ctx.accounts.buyer_payer.to_account_info(),
                    },
                ),
                artist_royalty,
                decimals,
            )?;
        }

        if fee_amount > 0 {
            token_interface::transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.buyer_token_account.to_account_info(),
                        mint: ctx.accounts.payment_mint.to_account_info(),
                        to: ctx.accounts.treasury_token_account.to_account_info(),
                        authority: ctx.accounts.buyer_payer.to_account_info(),
                    },
                ),
                fee_amount,
                decimals,
            )?;
        }

        if seller_net > 0 {
            token_interface::transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.buyer_token_account.to_account_info(),
                        mint: ctx.accounts.payment_mint.to_account_info(),
                        to: ctx.accounts.seller_token_account.to_account_info(),
                        authority: ctx.accounts.buyer_payer.to_account_info(),
                    },
                ),
                seller_net,
                decimals,
            )?;
        }

        emit!(SecondaryResaleSettledEvent {
            token_id: art.token_id,
            seller,
            buyer: new_collector,
            gross_price: gross,
            artist_royalty_paid: artist_royalty,
            protocol_fee_paid: fee_amount,
        });

        Ok(())
    }

    /// Strict one-way export from email custodial vault to collector's self-custody Solana wallet.
    /// Permanently sets `custodial_held = false`, locking out `custodial_relayer` and `admin`.
    pub fn export_to_self_custody(ctx: Context<ExportToSelfCustody>) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let caller = ctx.accounts.authority.key();
        require!(
            caller == cfg.custodial_relayer || caller == cfg.admin,
            OnaError::Unauthorized
        );

        let art = &mut ctx.accounts.artwork;
        require!(art.custodial_held, OnaError::AlreadySelfCustodied);
        require!(art.escrow_released, OnaError::DeliveryEscrowPending);

        let external_wallet = ctx.accounts.external_wallet.key();
        require!(external_wallet != Pubkey::default(), OnaError::InvalidAddress);

        art.custodial_held = false;
        art.resale_active = false;
        art.resale_ask_price = 0;
        art.owner = external_wallet;

        Ok(())
    }

    /// Allows ONLY the original artist to rotate their royalty payout address.
    pub fn update_artist_beneficiary(ctx: Context<UpdateArtistBeneficiary>) -> Result<()> {
        let art = &mut ctx.accounts.artwork;
        let new_artist = ctx.accounts.new_artist.key();
        require!(new_artist != Pubkey::default(), OnaError::InvalidAddress);
        art.artist = new_artist;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: Verified non-default relayer authority key stored in config
    #[account(constraint = custodial_relayer.key() != Pubkey::default() @ OnaError::InvalidAddress)]
    pub custodial_relayer: UncheckedAccount<'info>,
    /// CHECK: Verified non-default NTAG 424 DNA SUN co-signer stored in config
    #[account(constraint = nfc_sun_verifier.key() != Pubkey::default() @ OnaError::InvalidAddress)]
    pub nfc_sun_verifier: UncheckedAccount<'info>,
    /// CHECK: Verified non-default treasury recipient stored in config
    #[account(constraint = protocol_treasury.key() != Pubkey::default() @ OnaError::InvalidAddress)]
    pub protocol_treasury: UncheckedAccount<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + ProtocolConfig::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, ProtocolConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TransferAdmin<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        has_one = admin @ OnaError::Unauthorized,
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,
    /// CHECK: Verified non-default nominated admin key
    pub new_pending_admin: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub pending_admin: Signer<'info>,
    #[account(
        mut,
        has_one = pending_admin @ OnaError::Unauthorized,
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,
}

#[derive(Accounts)]
#[instruction(tag_hardware_hash: [u8; 32])]
pub struct MintCertificate<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,
    /// CHECK: Artist beneficiary pubkey recorded on the certificate
    #[account(constraint = artist.key() != Pubkey::default() @ OnaError::InvalidAddress)]
    pub artist: UncheckedAccount<'info>,
    /// CHECK: Initial collector or deterministic custodial vault pubkey
    #[account(constraint = buyer_recipient.key() != Pubkey::default() @ OnaError::InvalidAddress)]
    pub buyer_recipient: UncheckedAccount<'info>,
    pub payment_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = authority,
        space = 8 + ArtworkCertificate::INIT_SPACE,
        seeds = [b"artwork", tag_hardware_hash.as_ref()],
        bump
    )]
    pub artwork: Account<'info, ArtworkCertificate>,
    #[account(
        init,
        payer = authority,
        seeds = [b"escrow", artwork.key().as_ref()],
        bump,
        token::mint = payment_mint,
        token::authority = artwork,
        token::token_program = token_program
    )]
    pub escrow_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = payment_mint,
        token::authority = authority,
        token::token_program = token_program
    )]
    pub payer_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ConfirmPhysicalDelivery<'info> {
    pub caller: Signer<'info>,
    pub nfc_sun_verifier: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        mut,
        seeds = [b"artwork", artwork.tag_hardware_hash.as_ref()],
        bump = artwork.bump
    )]
    pub artwork: Account<'info, ArtworkCertificate>,
    #[account(address = artwork.payment_mint @ OnaError::InvalidPaymentMint)]
    pub payment_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [b"escrow", artwork.key().as_ref()],
        bump,
        token::mint = payment_mint,
        token::authority = artwork,
        token::token_program = token_program
    )]
    pub escrow_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = payment_mint,
        token::authority = artwork.artist,
        token::token_program = token_program
    )]
    pub artist_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ManageResaleListing<'info> {
    pub caller: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        mut,
        seeds = [b"artwork", artwork.tag_hardware_hash.as_ref()],
        bump = artwork.bump
    )]
    pub artwork: Account<'info, ArtworkCertificate>,
}

#[derive(Accounts)]
pub struct SettleSecondaryResale<'info> {
    #[account(mut)]
    pub buyer_payer: Signer<'info>,
    /// CHECK: Optional co-signer when `nfc_tap_counter > 0`; checked in handler against `config.nfc_sun_verifier`
    pub nfc_sun_verifier: UncheckedAccount<'info>,
    /// CHECK: Incoming collector wallet or custodial vault pubkey
    pub new_collector: UncheckedAccount<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        mut,
        seeds = [b"artwork", artwork.tag_hardware_hash.as_ref()],
        bump = artwork.bump
    )]
    pub artwork: Account<'info, ArtworkCertificate>,
    #[account(address = artwork.payment_mint @ OnaError::InvalidPaymentMint)]
    pub payment_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = payment_mint,
        token::authority = buyer_payer,
        token::token_program = token_program
    )]
    pub buyer_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = payment_mint,
        token::authority = artwork.artist,
        token::token_program = token_program
    )]
    pub artist_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = payment_mint,
        token::authority = config.protocol_treasury,
        token::token_program = token_program
    )]
    pub treasury_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = payment_mint,
        token::authority = artwork.owner,
        token::token_program = token_program
    )]
    pub seller_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ExportToSelfCustody<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        mut,
        seeds = [b"artwork", artwork.tag_hardware_hash.as_ref()],
        bump = artwork.bump
    )]
    pub artwork: Account<'info, ArtworkCertificate>,
    /// CHECK: Destination collector self-custody wallet verified non-default
    pub external_wallet: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct UpdateArtistBeneficiary<'info> {
    pub artist: Signer<'info>,
    #[account(
        mut,
        has_one = artist @ OnaError::Unauthorized,
        seeds = [b"artwork", artwork.tag_hardware_hash.as_ref()],
        bump = artwork.bump
    )]
    pub artwork: Account<'info, ArtworkCertificate>,
    /// CHECK: New artist wallet verified non-default
    pub new_artist: UncheckedAccount<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub custodial_relayer: Pubkey,
    pub nfc_sun_verifier: Pubkey,
    pub protocol_treasury: Pubkey,
    pub protocol_fee_bps: u16,
    pub total_minted: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ArtworkCertificate {
    pub token_id: u64,
    pub artist: Pubkey,
    pub owner: Pubkey,
    pub payment_mint: Pubkey,
    pub royalty_bps: u16,
    pub tag_hardware_hash: [u8; 32],
    pub last_tap_counter: u32,
    pub edition_index: u16,
    pub edition_total: u16,
    pub escrow_amount: u64,
    pub escrow_released: bool,
    pub physical_verified: bool,
    pub custodial_held: bool,
    pub resale_active: bool,
    pub resale_ask_price: u64,
    pub recorded_primary_price: u64,
    #[max_len(96)]
    pub ipfs_provenance_cid: String,
    pub bump: u8,
}

#[event]
pub struct CertificateMintedEvent {
    pub token_id: u64,
    pub artist: Pubkey,
    pub owner: Pubkey,
    pub tag_hardware_hash: [u8; 32],
    pub royalty_bps: u16,
    pub escrow_amount: u64,
    pub ipfs_provenance_cid: String,
}

#[event]
pub struct PhysicalDeliveryConfirmedEvent {
    pub token_id: u64,
    pub collector: Pubkey,
    pub artist: Pubkey,
    pub tap_counter: u32,
    pub escrow_released: u64,
}

#[event]
pub struct SecondaryResaleSettledEvent {
    pub token_id: u64,
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub gross_price: u64,
    pub artist_royalty_paid: u64,
    pub protocol_fee_paid: u64,
}

#[error_code]
pub enum OnaError {
    #[msg("Caller is not authorized to perform this provenance action")]
    Unauthorized,
    #[msg("Invalid zero/default public key")]
    InvalidAddress,
    #[msg("Creator royalty exceeds 25.00% (2500 bps) maximum")]
    InvalidRoyaltyBps,
    #[msg("Protocol fee exceeds 8.00% (800 bps) maximum")]
    InvalidProtocolFeeBps,
    #[msg("Edition index must be between 1 and edition total")]
    InvalidEdition,
    #[msg("IPFS CIDv1 string must be 1..=96 bytes")]
    InvalidCidLength,
    #[msg("NTAG 424 DNA hardware hash cannot be all zeroes")]
    InvalidTagHash,
    #[msg("Payment mint does not match artwork certificate settlement mint")]
    InvalidPaymentMint,
    #[msg("NFC SUN signature deadline has expired")]
    SignatureExpired,
    #[msg("Invalid NFC SUN verifier signer")]
    InvalidNfcVerifier,
    #[msg("Replay rejected: NFC tap counter must strictly exceed last verified counter")]
    InvalidNfcCounter,
    #[msg("Primary delivery escrow has not yet been confirmed via physical NFC tap")]
    DeliveryEscrowPending,
    #[msg("Certificate is not currently listed for secondary resale")]
    NotListedForResale,
    #[msg("Seller cannot purchase their own secondary listing")]
    SelfPurchaseDisallowed,
    #[msg("Ask price must be strictly positive")]
    InsufficientPayment,
    #[msg("Certificate has already been exported to collector self-custody")]
    AlreadySelfCustodied,
    #[msg("Checked arithmetic overflow")]
    MathOverflow,
}
