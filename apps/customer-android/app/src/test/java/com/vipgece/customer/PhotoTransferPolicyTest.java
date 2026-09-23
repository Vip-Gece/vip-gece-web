package com.vipgece.customer;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import org.junit.Test;
import static org.junit.Assert.*;

public final class PhotoTransferPolicyTest {
    @Test public void galleryRejectsNonMediaPathsBeforeNetworkAccess() throws Exception {
        ApiClient client=new ApiClient("https://gateway.example.invalid");
        for(String path:new String[]{"https://other.example.invalid/image.jpg", "/api/customer/mobile/login",
                "/api/customer/mobile/profiles/p/images/12", "/api/customer/mobile/profiles/p/images/0?token=x",
                "/api/customer/mobile/profiles/p/images/../0"}) {
            try {client.photo(path, "fixture");fail("Invalid path accepted");}
            catch(ApiClient.Failure error){assertEquals("INVALID_IMAGE_PATH",error.code);}
        }
    }

    @Test public void boundedReadsPreserveExactOriginalBytes() throws Exception {
        byte[] source=new byte[32769];
        for(int i=0;i<source.length;i++)source[i]=(byte)(i%251);
        assertArrayEquals(source,ApiClient.readBounded(new ByteArrayInputStream(source),source.length));
    }

    @Test public void oversizedAndMissingImageStreamsCannotSucceed() throws Exception {
        assertThrows(IOException.class,()->ApiClient.readBounded(new ByteArrayInputStream(new byte[1025]),1024));
        assertThrows(IOException.class,()->ApiClient.readBounded(null,1024));
    }
}
