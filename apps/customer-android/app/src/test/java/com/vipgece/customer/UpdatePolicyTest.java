package com.vipgece.customer;

import org.junit.Test;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.util.Base64;
import java.nio.charset.StandardCharsets;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import static org.junit.Assert.*;

public final class UpdatePolicyTest {
    @Test public void verifiedDownloadPreservesEveryByte() throws Exception {
        byte[] apk=new byte[150000];new java.util.Random(42).nextBytes(apk);
        ByteArrayOutputStream out=new ByteArrayOutputStream();
        UpdatePolicy.verifyApkBytes(new ByteArrayInputStream(apk),out,apk.length,UpdatePolicy.digest(apk));
        assertArrayEquals(apk,out.toByteArray());
        UpdatePolicy.verifyApkBytes(new ByteArrayInputStream(apk),null,apk.length,UpdatePolicy.digest(apk));
    }
    @Test public void corruptTruncatedAndOversizedDownloadsAreRejected() throws Exception {
        byte[] apk={1,2,3,4};String hash=UpdatePolicy.digest(apk);
        assertThrows(SecurityException.class,()->UpdatePolicy.verifyApkBytes(new ByteArrayInputStream(new byte[]{4,3,2,1}),null,4,hash));
        assertThrows(SecurityException.class,()->UpdatePolicy.verifyApkBytes(new ByteArrayInputStream(new byte[]{1,2,3}),null,4,hash));
        ByteArrayOutputStream out=new ByteArrayOutputStream();
        assertThrows(SecurityException.class,()->UpdatePolicy.verifyApkBytes(new ByteArrayInputStream(new byte[]{1,2,3,4,5}),out,4,hash));
        assertTrue(out.size()<=4);
    }
    @Test public void interruptedAndInvalidSizeDownloadsCannotSucceed() throws Exception {
        byte[] apk={1};String hash=UpdatePolicy.digest(apk);
        assertThrows(SecurityException.class,()->UpdatePolicy.verifyApkBytes(new ByteArrayInputStream(apk),null,UpdatePolicy.MAX_APK+1,hash));
        Thread.currentThread().interrupt();
        try {assertThrows(java.io.InterruptedIOException.class,()->UpdatePolicy.verifyApkBytes(new ByteArrayInputStream(apk),null,1,hash));}
        finally {Thread.interrupted();}
    }
    @Test public void rejectsInsecureAndInjectedOrigins() {
        for(String value:new String[]{"http://vip-gece.site","https://127.0.0.1","https://host.local","https://a@vip-gece.site","https://vip-gece.site:443","https://vip-gece.site/path","https://vip-gece.site?x=1"}) {
            assertThrows(RuntimeException.class,()->UpdatePolicy.origin(value));
        }
        assertEquals("vip-gece.site",UpdatePolicy.origin("https://vip-gece.site").getHost());
    }
    @Test public void apkCannotEscapeDistributionPath() {
        var origin=UpdatePolicy.origin("https://vip-gece.site");
        for(String path:new String[]{"https://evil.test/app.apk","//evil.test/a.apk","/public/downloads/../a.apk","/public/downloads/vip-gece-customer-clean-%2e.apk","/public/downloads/vip-gece-customer-clean-a.apk?x=1"})
            assertThrows(SecurityException.class,()->UpdatePolicy.apkUrl(origin,path));
        assertEquals("https://vip-gece.site/public/downloads/vip-gece-customer-clean-2.apk",UpdatePolicy.apkUrl(origin,"/public/downloads/vip-gece-customer-clean-2.apk").toString());
    }
    @Test public void signatureRejectsTamperingAndOtherKeys() throws Exception {
        KeyPairGenerator generator=KeyPairGenerator.getInstance("RSA");generator.initialize(2048);KeyPair key=generator.generateKeyPair();
        byte[] content="signed update fixture".getBytes(StandardCharsets.UTF_8);
        Signature signer=Signature.getInstance("SHA256withRSA");signer.initSign(key.getPrivate());signer.update(content);
        String signature=Base64.getEncoder().encodeToString(signer.sign()),payload=Base64.getEncoder().encodeToString(content);
        String publicKey=Base64.getEncoder().encodeToString(key.getPublic().getEncoded());
        assertArrayEquals(content,UpdatePolicy.verify(payload,signature,publicKey));
        assertThrows(SecurityException.class,()->UpdatePolicy.verify(Base64.getEncoder().encodeToString("altered".getBytes(StandardCharsets.UTF_8)),signature,publicKey));
        String other=Base64.getEncoder().encodeToString(generator.generateKeyPair().getPublic().getEncoded());
        assertThrows(SecurityException.class,()->UpdatePolicy.verify(payload,signature,other));
    }
    @Test public void metadataRejectsExpiryWrongPackageAndOversize() {
        String hash="a".repeat(64);long now=1800000000;
        UpdatePolicy.metadata("com.vipgece.customer",3,100,hash,hash,now-60,now+86400,now,26,36);
        assertThrows(SecurityException.class,()->UpdatePolicy.metadata("other.app",3,100,hash,hash,now-60,now+86400,now,26,36));
        assertThrows(SecurityException.class,()->UpdatePolicy.metadata("com.vipgece.customer",3,100,hash,hash,now-60,now-1,now,26,36));
        assertThrows(SecurityException.class,()->UpdatePolicy.metadata("com.vipgece.customer",3,UpdatePolicy.MAX_APK+1,hash,hash,now-60,now+100,now,26,36));
        assertThrows(SecurityException.class,()->UpdatePolicy.metadata("com.vipgece.customer",3,100,hash,hash,now+1000,now+2000,now,26,36));
        assertThrows(SecurityException.class,()->UpdatePolicy.metadata("com.vipgece.customer",3,100,hash,hash,now-60,now+86400,now,37,36));
    }
    @Test public void installedAndObservedVersionsCannotBeRolledBack() {
        UpdatePolicy.version(4,2,4);
        assertThrows(SecurityException.class,()->UpdatePolicy.version(2,2,2));
        assertThrows(SecurityException.class,()->UpdatePolicy.version(3,2,4));
    }
}
